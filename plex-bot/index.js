const PlexAPI = require('plex-api');
const path = require('path');
const fs = require('fs').promises;
const {spawn} = require('child_process');
const fetch = require('isomorphic-fetch');
const WebSocket = require('ws');
const cookie = require('cookie');

require('dotenv').config()
const argv = require('minimist')(process.argv.slice(2));

const historyPath = path.join(__dirname, 'history.json');
const history = require(historyPath);

const plex = new PlexAPI({
  hostname: process.env.PLEX_HOST,
  username: process.env.PLEX_USER,
  password: process.env.PLEX_PASSWORD,
  managedUser: {
    name: process.env.PLEX_MANAGED_USER,
  },
  options: {
    identifier: 'plex-stream',
    deviceName: 'Stream',
    product: 'Stream',
  },
});

(async function() {
  const library = await plex.query(`/library/sections/${process.env.PLEX_LIBRARY_ID}/all`);
  const movies = library.MediaContainer.Metadata.filter(filterMetadata);
  console.log(`found ${movies.length} movies`);

  let previous = history.previous && !argv['ignore-previous']
    ? movies.find(movie => movie.key === history.previous)
    : null;
  if (!previous) {
    previous = movies[Math.floor(Math.random() * movies.length)];
  }

  let current;
  for await (let next of selectMovies(previous, movies)) {
    if (!current) {
      current = next;
      continue;
    }

    const {movie, streams} = current;
    current = next;

    console.log(`beginning ${movie.title} (${movie.year})`)
    await Promise.allSettled([
      logAsyncFn('playing movie', playMovie(movie, streams, next.movie)),
      logAsyncFn('updating history', appendToHistory(movie)),
      logAsyncFn('updating angelthump', updateAngelthumpTitle(movie)),
      logAsyncFn('notifying chat', notifyChat(movie)),
    ]);

    await new Promise(resolve => setTimeout(process.env.INTERMISSION_MS, resolve));
  }
})();

async function* selectMovies(previous, movies) {
  while (true) {
    const next = selectNext(previous, movies);
    const streams = await selectMediaStreams(next, movies);
    if (streams) {
      yield {
        movie: next,
        streams,
      };
    }
    previous = next;
  }
}

function selectNext(prev, movies) {
  const weights = generateWeights(prev, movies);
  const weightSum = weights.reduce((sum, [weight]) => sum + weight, 0);

  const rand = (1 - Math.pow(Math.random(), 10)) * weightSum;

  let runningSum = weightSum;
  const next = weights.find(([weight, i]) => {
    runningSum -= weight;
    return runningSum <= rand
      && movies[i].key !== prev.key
      && history[movies[i].key] === undefined;
  });

  return movies[next[1]];
}

const toLookupTable = values => (values || []).reduce((t, {tag}) => ({...t, [tag]: true}), {});
const countMatches = (values, lookupTable) => (values || []).reduce((n, {tag}) => lookupTable[tag] ? n + 1 : n, 0);

function generateWeights(prev, movies) {
  const director = toLookupTable(prev.Director);
  const genre = toLookupTable(prev.Genre);
  const writer = toLookupTable(prev.Writer);
  const country = toLookupTable(prev.Country);
  const role = toLookupTable(prev.Role);
  const {year, rating} = prev;

  return movies
    .map((movie, i) => {
      let weight = 0;
      weight += countMatches(movie.Director, director) * (+process.env.DIRECTOR_WEIGHT || 1);
      weight += countMatches(movie.Genre, genre) * (+process.env.GENRE_WEIGHT || 1);
      weight += countMatches(movie.Writer, writer) * (+process.env.WRITER_WEIGHT || 1);
      weight += countMatches(movie.Country, country) * (+process.env.COUNTRY_WEIGHT || 1);
      weight += countMatches(movie.Role, role) * (+process.env.ROLE_WEIGHT || 1);
      weight += (movie.year === year ? 1 : 0) * (+process.env.YEAR_WEIGHT || 1);
      weight *= rating;
      return [weight, i];
    })
    .sort(([a], [b]) => b - a);
}

async function selectMediaStreams(movie) {
  const record = await plex.query(movie.key);
  const media = record.MediaContainer.Metadata[0].Media
    .filter(filterMedia)
    .sort((a, b) => a.bitrate - b.bitrate);

  for (m of media) {
    const part = m.Part[0]
    const video = part.Stream
      .filter(stream => stream.streamType === 1)
      .shift();
    const audio = part.Stream
      .filter(stream => stream.streamType === 2 && stream.languageCode === 'eng')
      .shift();

    if (video && audio) {
      return {video, audio, part};
    }
  }
};

const filterMedia = media => (
  media.bitrate >= process.env.MIN_BITRATE &&
  media.bitrate <= process.env.MAX_BITRATE &&
  media.height >= process.env.MIN_RESOLUTION &&
  media.height <= process.env.MAX_RESOLUTION
);

const filterMetadata = ({type, Media, year, rating}) => (
  type === 'movie' &&
  Media.some(filterMedia) &&
  year >= process.env.MIN_YEAR &&
  year <= process.env.MAX_YEAR &&
  rating >= process.env.MIN_RATING &&
  rating <= process.env.MAX_RATING
);

function playMovie(movie, {audio, video, part}, nextMovie) {
  const title = `${movie.title} (${movie.year}) • ${nextMovie.title} (${nextMovie.year})`;
  const titleDrawText = formatDrawText(title, 10, 10);

  const now = new Date();
  const timestamp = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const timeDrawText = formatDrawText(`${timestamp} ${process.env.TIME_ZONE}`, 10, 36)

  const keyInterval = Math.round(video.frameRate) * 2;

  const options = [
    '-re',
    '-i', part.file,
    '-vf', `${titleDrawText}, ${timeDrawText}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', process.env.ENCODER_PRESET || 'veryfast',
    '-tune', process.env.ENCODER_TUNE || 'zerolatency',
    '-fflags', '+igndts',
    '-fflags', '+genpts',
    '-async', '1',
    '-vsync', '1',
    '-map', `0:${video.index}`,
    '-map', `0:${audio.index}`,
    '-b:v', '6000k',
    '-maxrate', '6000k',
    '-x264-params', `keyint=${keyInterval}`,
    '-c:a', 'aac',
    '-strict', '-2',
    '-ar', '44100',
    '-b:a', '160k',
    '-ac', '2',
    '-bufsize', '7000k',
    '-f', 'flv', process.env.ANGELTHUMP_INGEST,
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', options);
    ffmpeg.stdout.pipe(process.stdout);
    ffmpeg.stderr.pipe(process.stderr);
    ffmpeg.on('close', resolve);
    ffmpeg.on('error', reject);
  });
};

function formatDrawText(text, x, y) {
  const sanitizedTitle = text.replace(/(\:)/g, '\\$1').replace(/\'/g, '');
  return `drawtext=text='${sanitizedTitle}': fontcolor=gray@0.4: fontsize=18: x=${x}: y=${y}`
}

async function appendToHistory(movie) {
  history.previous = movie.key;
  history[movie.key] = movie.title;
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
};

async function updateAngelthumpTitle(movie) {
  const accessToken = await createAngelthumpToken();
  const res = await fetch('https://api.angelthump.com/user/v1/title', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({title: `${movie.title} (${movie.year})`}),
  });
  return await res.text()
}

async function createAngelthumpToken() {
  const res = await fetch('https://sso.angelthump.com/authentication', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      strategy: 'local',
      username: process.env.ANGELTHUMP_USER,
      password: process.env.ANGELTHUMP_PASSWORD,
    }),
  });
  const {accessToken} = await res.json();
  return accessToken;
}

function notifyChat(movie) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        Cookie: cookie.serialize('jwt', process.env.STRIMS_JWT),
      }
    };
    const ws = new WebSocket('wss://chat.strims.gg/ws', [], options);

    ws.on('open', () => {
      const data = `${movie.title} (${movie.year}) started at ${process.env.STRIMS_URL}`;
      ws.send('MSG ' + JSON.stringify({data}))
      ws.close();

      resolve();
    });
    ws.on('error', reject);
  });
}

async function logAsyncFn(action, fn) {
  console.log(`${action}`);
  let res;
  try {
    res = await fn;
  } catch (e) {
    console.log(`error ${action} ${e}`);
    throw e;
  }
  console.log(`finished ${action}`);
  return res;
}
