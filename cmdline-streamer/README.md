# Command Line Streamer

Small script to automate background streaming of files or folder with ffmpeg

## Getting Started

Requires ffmpeg and python3. Once installed, set the environment variable to set
your Angelthump stream key

This has only been tested on Ubuntu and Manjaro, none *nix OSs may have issues.

### Prerequisites

- Angelthump key https://www.angelthump.com/dashboard/settings# set as `$ANGELTHUMP_STREAM_KEY` in environment variables

- Python3 https://www.python.org/downloads/
- FFmpeg https://ffmpeg.org/
- FFprobe https://ffmpeg.org/ffprobe.html

### Running
```
pip install -e git+https://github.com/MemeLabs/streaming.git#egg=atstreaming\&#subdirectory=cmdline-streamer
```

To see all available flags run:
```
python streaming.py --help

usage: streaming.py [-h] [-F FOLDER] [-f FILE] [-st SUBTRACK] [-sf SUBFILE] [-at AUDIOTRACK] [-t TITLE] [--show-time]
                    [--skip SKIP] [--max MAX] [-b BITRATE] [--preset PRESET] [--ingest INGEST]

optional arguments:
  -h, --help            show this help message and exit
  -F FOLDER, --folder FOLDER
                        Folder absolute path
  -f FILE, --file FILE  File absolute path
  -st SUBTRACK, --subtrack SUBTRACK
                        Subtitle track
  -sf SUBFILE, --subfile SUBFILE
                        Subtitle file
  -at AUDIOTRACK, --audiotrack AUDIOTRACK
                        Audio track
  -t TITLE, --title TITLE
                        Title to add to video feed
  --show-time           add stream start time to video feed
  --skip SKIP           Which episode to start at (0 index)
  --max MAX             Final episode # to stream
  -b BITRATE, --bitrate BITRATE
                        ffmpeg bitrate to stream at
  --preset PRESET       ffmpeg '-preset': [ultrafast, superfast, veryfast, faster, fast, medium, slow, veryslow]
  --ingest INGEST       Angelthump ingest server to point to: [sgp, lon, fra, blr, ams, nyc, sfo]
```

Example running that will iterate through entire folder where each episode will be run with audio track 1 and subtitle track 0.
```
ANGELTHUMP_STREAM_KEY="xxx" python streaming.py -F /absolute/path/to/favorite/anime/folder -at 1 -st 0
```
