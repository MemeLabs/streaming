# M3U8 to Angelthump

Quick script for streaming m3u8 to angelthump.

## Getting Started

Requires Python 3 and fFFmpeg. Once script downloaded you will need to have a copy of your angelthump stream key and use `--streamkey STREAMKEY`
to set it.

Streamkey does not need to be set everytime you use this script.

Only tested on Windows and Ubuntu. May not work on other operating systems.
### Prerequisites

Angelthump key https://www.angelthump.com/dashboard/settings#

Python 3 https://www.python.org/downloads/

FFmpeg https://ffmpeg.org/

### Running

To see all available flags run:

```
./m3u8.py --help
```

```
usage: m3u8.py streamlink [--streamkey]

positional arguments:
  streamlink

optional arguments:
  -h, --help            show this help message and exit
  -sk, --streamkey   Sets config's streamkey. If not called ffmpeg will use config file's 
                     streamkey.
```

#### First time:

```
./m3u8.py http://cool.site/stream.m3u8 --streamkey STREAMKEY
```

#### Usual use:
```
./m3u8.py http://cool.site/stream.m3u8
```
