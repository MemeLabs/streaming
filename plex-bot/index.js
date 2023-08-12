const {spawn} = require('child_process');
const {sprintf} = require('sprintf-js');
const cookie = require('cookie');
const dotenv = require('dotenv');
const fetch = require('isomorphic-fetch');
const fs = require('fs').promises;
const minimist = require('minimist');
const {promisify} = require('util');
const nameToImdb = promisify(require('name-to-imdb'));
const path = require('path');
const PlexAPI = require('plex-api');
const WebSocket = require('ws');

dotenv.config()
const argv = minimist(process.argv.slice(2));

const historyPath = path.join(__dirname, 'history.json');
const history = require(historyPath);

const plex = new PlexAPI({
  hostname: process.env.PLEX_HOST,
  username: process.env.PLEX_USER,
  password: process.env.PLEX_PASSWORD,
  managedUser: process.env.PLEX_MANAGED_USER && {
    name: process.env.PLEX_MANAGED_USER,
  },
  options: {
    identifier: 'plex-stream',
    deviceName: 'Stream',
    product: 'Stream',
  },
});

const keyInterval = 24 * 2;

(async function() {
  const playlists = await loadPlaylists();
  const library = await plex.query(`/library/sections/${process.env.PLEX_LIBRARY_ID}/all?type=1`);
  const exclude = await plex.query(`/library/sections/${process.env.PLEX_LIBRARY_ID}/all?type=1&label=104206`);
  const movies = library.MediaContainer.Metadata.filter(filterMetadata(exclude));
  console.log(`filtered count: ${movies.length}`);

  let previous = history.previous && !argv['ignore-previous'] && movies.find(({key}) => key === history.previous);
  if (!previous) {
    previous = movies[Math.floor(Math.random() * movies.length)];
  }

  let current;
  for await (let next of selectMovies(previous, movies, playlists)) {
    if (!current) {
      current = next;
      continue;
    }

    const {movie, streams} = current;
    current = next;

    console.log(`beginning ${movie.title} (${movie.year})`)
    try {
      await Promise.allSettled([
        logAsyncFn('playing movie', playMovie(movie, streams, next.movie)),
        logAsyncFn('updating angelthump', updateAngelthumpTitle(movie)),
        logAsyncFn('notifying chat', notifyChat(movie)),
      ]);
    } catch (e) {
      console.log('error playing movie', err);
    }

    await new Promise(resolve => setTimeout(resolve, process.env.INTERMISSION_MS));
  }
})();

async function loadPlaylists() {
  const playlistsRes = await plex.query('/playlists');
  if (!playlistsRes.MediaContainer) {
    return {metadata: [], index: {}}
  }

  const metadata = await Promise.all(playlistsRes.MediaContainer.Metadata
    .map(({key}) => plex.query(key).then(res => res.MediaContainer.Metadata)));
  const index = metadata.flat().filter(v => !!v).reduce((index, {key}) => ({...index, [key]: true}), {});
  return {metadata, index};
}

async function* selectMovies(previous, movies, playlists) {
  while (true) {
    const next = selectNext(previous, movies, playlists);
    await appendToHistory(next);

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

function selectNext(prev, movies, playlists) {
  // if the previous movie was in a playlist pick the next movie in that playlist
  let playlist = findPlaylist(prev, playlists);
  if (playlist) {
    const nextIndex = playlist.findIndex(({key}) => key === prev.key) + 1;
    if (nextIndex < playlist.length) {
      return playlist[nextIndex];
    }
  }

  const weights = generateWeights(prev, movies);
  const weightSum = weights.reduce((sum, [weight]) => sum + weight, 0);

  const rand = (1 - Math.pow(Math.random(), 10)) * weightSum;

  let runningSum = weightSum;
  const nextWeight = weights.find(([weight, i]) => {
    runningSum -= weight;
    return runningSum <= rand
      && movies[i].key !== prev.key
      && history[movies[i].key] === undefined;
  });
  const next = movies[nextWeight[1]]

  // if the selected movie exists in a playlist start from the beginning
  playlist = findPlaylist(next, playlists);
  if (playlist) {
    return playlist[0];
  }

  return next;
}

function findPlaylist(movie, playlists) {
  if (playlists.index[movie.key]) {
    return playlists.metadata.find(metadata => metadata && metadata.some(({key}) => key === movie.key));
  }
}

const toLookupTable = values => (values || []).reduce((t, {tag}) => ({...t, [tag]: true}), {});
const countMatches = (values, lookupTable) => (values || []).reduce((n, {tag}) => lookupTable[tag] ? n + 1 : n, 0);

function generateWeights(prev, movies) {
  const director = toLookupTable(prev.Director);
  const genre = toLookupTable(prev.Genre);
  const writer = toLookupTable(prev.Writer);
  const country = toLookupTable(prev.Country);
  const role = toLookupTable(prev.Role);
  const {year} = prev;

  return movies
    .map((movie, i) => {
      let weight = 0;
      weight += countMatches(movie.Director, director) * (+process.env.DIRECTOR_WEIGHT || 1);
      weight += countMatches(movie.Genre, genre) * (+process.env.GENRE_WEIGHT || 1);
      weight += countMatches(movie.Writer, writer) * (+process.env.WRITER_WEIGHT || 1);
      weight += countMatches(movie.Country, country) * (+process.env.COUNTRY_WEIGHT || 1);
      weight += countMatches(movie.Role, role) * (+process.env.ROLE_WEIGHT || 1);
      weight += (movie.year === year ? 1 : 0) * (+process.env.YEAR_WEIGHT || 1);
      weight += movie.rating * (+process.env.RATING_WEIGHT || 1);
      return [weight, i];
    })
    .sort(([a], [b]) => b - a);
}

async function selectMediaStreams(movie) {
  const record = await plex.query(movie.key);
  const media = record.MediaContainer.Metadata[0].Media
    .filter(filterMedia)
    .sort((a, b) => b.bitrate - a.bitrate);

  for (m of media) {
    const {Stream, file, width} = m.Part[0];
    const video = Stream?.find(({streamType}) => streamType === 1);

    const audioTracks = Stream?.filter(({streamType, languageCode}) => streamType === 2);
    const audio = audioTracks?.length === 1 ? audioTracks[0] : audioTracks?.find(({streamType, languageCode}) => languageCode === 'eng');

    if (video && audio) {
      return {video, audio, file, width};
    }
  }
}

const filterMedia = media => (
  media.bitrate >= process.env.MIN_BITRATE &&
  media.bitrate <= process.env.MAX_BITRATE &&
  media.height >= process.env.MIN_RESOLUTION &&
  media.height <= process.env.MAX_RESOLUTION
);

const filterMetadata = (exclude) => {
  const excludeKeys = exclude.MediaContainer.Metadata.reduce((prev, {key}) => ({[key]: true, ...prev}), {});

  return ({type, key, Media, year, rating}) => (
    type === 'movie' &&
    !excludeKeys[key] &&
    Media.some(filterMedia) &&
    year >= process.env.MIN_YEAR &&
    year <= process.env.MAX_YEAR &&
    rating >= process.env.MIN_RATING &&
    rating <= process.env.MAX_RATING
  );
}

function localFilePath(file) {
  const parts = file.split('/');
  parts[0] = process.env.LIBRARY_ROOT;
  return parts.join(path.sep);
}

function playMovie(movie, {audio, video, file, width}, nextMovie) {
  let fontSize = 18;
  let lineHeight = 26;
  if (width < 1920) {
    fontSize = 12;
    lineHeight = 18
  }

  const title = `${movie.title} (${movie.year}) · ${nextMovie.title} (${nextMovie.year})`;
  const titleDrawText = formatDrawText(title, 10, 10, fontSize);

  const now = new Date();
  const timestamp = sprintf("%02d:%02d %s", now.getHours(), now.getMinutes(), process.env.TIME_ZONE);
  const timeDrawText = formatDrawText(timestamp, 10, 10 + lineHeight, fontSize)

  const keyInterval = Math.round(video.frameRate) * 2;

  const options = [
    '-init_hw_device', 'cuda=cuda',
    '-filter_hw_device', 'cuda',
    '-hwaccel', 'nvdec',
    '-hwaccel_output_format', 'cuda',
    '-hwaccel_device', '0',
    '-re',
    '-fflags',  '+igndts',
    '-i', localFilePath(file),
    '-map', `0:${video.index}`,
    '-map', `0:${audio.index}`,
    '-filter_complex', `[0:v]hwdownload,format=nv12,${titleDrawText},${timeDrawText}`,
    '-c:v', 'h264_nvenc',
    '-bf', '3',
    '-b_ref_mode', 'middle',
    '-temporal-aq', '1',
    '-rc-lookahead', '10',
    '-pix_fmt', 'yuv420p',
    '-preset',  'p7',
    '-tune',  'll',
    '-profile',  'main',
    '-no-scenecut',  '1',
    '-g',  `${keyInterval}`,
    '-keyint_min',  `${keyInterval}`,
    '-rc',  'cbr',
    '-2pass', '1',
    '-multipass', 'qres',
    '-b:v',  '6000k',
    '-bufsize',  '3000k',
    '-maxrate',  '6000k',
    '-c:a',  'aac',
    '-strict', '-2',
    '-ar',  '44100',
    '-b:a',  '160k',
    '-ac',  '2',
    '-fflags',  '+genpts',
    '-flvflags',  'no_duration_filesize',
    '-f',  'flv',  process.env.ANGELTHUMP_INGEST,
  ];

  const ffmpeg = spawn(process.env.FFMPEG_PATH || 'ffmpeg', options);
  ffmpeg.stdout.pipe(process.stdout);
  ffmpeg.stderr.pipe(process.stderr);

  return new Promise((resolve, reject) => {
    ffmpeg.on('close', resolve);
    ffmpeg.on('error', reject);
  });
}

function formatDrawText(text, x, y, size) {
  const sanitizedTitle = text.replace(/(\:)/g, '\\$1').replace(/\'/g, '');
  return `drawtext=fontfile=${process.env.FONT_PATH}:text='${sanitizedTitle}':fontcolor=gray@0.4:fontsize=${size}:x=${x}:y=${y}`
}

async function appendToHistory(movie) {
  history.previous = movie.key;
  history[movie.key] = movie.title;
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
}

async function updateAngelthumpTitle(movie) {
  const accessToken = await createAngelthumpToken();
  const res = await fetch('https://api.angelthump.com/v2/user/title', {
    method: 'PATCH',
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

async function notifyChat(movie) {
  const options = {
    headers: {
      Cookie: cookie.serialize('jwt', process.env.STRIMS_JWT),
      Origin: 'https://chat.strims.gg',
    },
  };
  const ws = new WebSocket('wss://chat.strims.gg/ws', [], options);

  const [metadata] = await Promise.all([
    getMetadata(movie),
    new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    }),
  ]);

  const emotes = process.env.STRIMS_EMOTES && process.env.STRIMS_EMOTES.split(",")
  const selectedEmote = emotes ? emotes[Math.floor(Math.random() * emotes.length)] : "";
  const data = `${selectedEmote} ${movie.title} (${movie.year})${metadata} started at ${process.env.STRIMS_URL}`;
  ws.send('MSG ' + JSON.stringify({data}));
  ws.close();
}

async function getMetadata(movie) {
  let metadata = '';
  try {
    const title = encodeURIComponent(movie.title);
    const year = encodeURIComponent(movie.year);
    const res = await fetch(`http://www.omdbapi.com/?apikey=${process.env.OMDB_API_KEY}&type=movie&t=${title}&y=${year}`);
    const data = await res.json();

    if (data.Response !== 'True') {
      return '';
    }

    if (data.imdbID) {
      metadata += ` - imdb.com/title/${data.imdbID}`;
    }

    console.log(data);

    const ratings = [];
    for (const {Source, Value} of data.Ratings) {
      switch (Source) {
        case 'Internet Movie Database':
          ratings.push(`IMDB: ${Value.replace(/\/10$/, '')}`);
          break;
        case 'Rotten Tomatoes':
          ratings.push(`RT: ${Value}`);
          break;
        case 'Metacritic':
          ratings.push(`MC: ${Value.replace(/\/100$/, '')}`);
          break;
      }
    }
    if (ratings.length) {
      metadata += ` (${ratings.join(', ')})`;
    }
  } catch (e) {}

  return metadata;
}

async function logAsyncFn(action, fn) {
  console.log(action);
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
