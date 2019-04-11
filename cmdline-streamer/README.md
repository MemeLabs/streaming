# Command Line Streamer

Small script to automate background streaming of files or folder with ffmpeg

## Getting Started

Requires ffmpeg and python3. Once script downloaded you will need to have a copy of your angelthump stream key and change the filepath to read that file.

This has only been tested on Ubuntu and Manjaro, none *nix OSs may have issues.

### Prerequisites

Angelthump key https://www.angelthump.com/dashboard/settings#

Python3 https://www.python.org/downloads/

Ffmpeg https://ffmpeg.org/

Change line 84 to path of angelthump key

### Running

To see all available flags run:

```
./streamscript --help
```

Example running

```
./streamscript -F /absolute/path/to/favorite/anime/folder -at 1 -st 0
```

The above will iterate through entire folder where each episode will be run with audio track 1 and subtitle track 0.
