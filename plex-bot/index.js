const PlexAPI = require('plex-api');
const path = require('path');
const fs = require('fs');
const https = require('https');
const {spawn} = require('child_process');
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

function selectMediaStreams(previous, movies) {
  const next = selectNext(previous, movies)

  history.previous = next.key;
  history[next.key] = next.title;
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

  return plex.query(next.key).then(result => {
    const media = result.MediaContainer.Metadata[0].Media
      .sort((a, b) => a.bitrate - b.bitrate)
      .pop();
    const part = media.Part[0];
    const video = part.Stream
      .filter(stream => stream.streamType === 1)
      .shift();
    const audio = part.Stream
      .filter(stream => stream.streamType === 2 && stream.languageCode === 'eng')
      .shift();

    if (!video || !audio) {
      return selectMediaStreams(next, movies);
    }
    return {next, video, audio, movies, part};
  });
}

plex.query('/library/sections/1/all')
  .then(result => result.MediaContainer.Metadata
      .map(metadata => ({
        ...metadata,
        HDMedia: metadata.Media
          .filter(media => media.bitrate > 3500 && media.height >= 720),
      }))
      .filter(({type, HDMedia}) => type === 'movie' && HDMedia.length > 0))
  .then(movies => {
    const previous = history.previous && !argv['ignore-previous']
      ? movies.find(movie => movie.key === history.previous)
      : movies[Math.floor(Math.random() * movies.length)];

    selectMediaStreams(previous, movies)
      .then(({movies, ...next}) => playNext(next, movies))
  })
  .catch(err => console.log({err}));

function playNext({next: current, audio, video, part}, movies) {
  selectMediaStreams(current, movies).then(({movies, ...next}) => {
    const title = `${current.title} (${current.year}) • ${next.next.title} (${next.next.year})`;
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
      '-use_wallclock_as_timestamps', '1',
      '-fflags', '+genpts',
      '-map', `0:${video.index}`,
      '-map', `0:${audio.index}`,
      '-b:v', '3500k',
      '-maxrate', '3500k',
      '-x264-params', `keyint=${keyInterval}`,
      '-c:a', 'aac',
      '-strict', '-2',
      '-ar', '44100',
      '-b:a', '160k',
      '-ac', '2',
      '-bufsize', '7000k',
      '-f', 'flv', process.env.ANGELTHUMP_INGEST,
    ];
    const ffmpeg = spawn('ffmpeg', options);
    ffmpeg.stdout.pipe(process.stdout);
    ffmpeg.stderr.pipe(process.stderr);
    ffmpeg.on('close', () => playNext(next, movies));
    ffmpeg.on('error', err => console.log(err));

    angelthumpLogin().then(accessToken => {
      const req = https.request({
        hostname: 'api.angelthump.com',
        path: '/user/v1/title',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      }, res => res.pipe(process.stdout));
      req.on('error', e => console.error(e));
      req.write(JSON.stringify({title: `${current.title} (${current.year})`}));
      req.end();
    });
  });
}

function formatDrawText(text, x, y) {
  const sanitizedTitle = text.replace(/(\:)/g, '\\$1').replace(/\'/g, '');
  return `drawtext=text='${sanitizedTitle}': fontcolor=gray@0.4: fontsize=18: x=${x}: y=${y}`
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

function angelthumpLogin() {
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'angelthump.com',
      path: '/authentication',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }, res => res.on('data', data => {
      const {accessToken} = JSON.parse(data);
      console.log(data.toString());
      resolve(accessToken);
    }));
    req.on('error', e => console.error(e));
    req.write(JSON.stringify({
      strategy: 'local-username',
      username: process.env.ANGELTHUMP_USER,
      password: process.env.ANGELTHUMP_PASSWORD,
    }));
    req.end();
  });
}
