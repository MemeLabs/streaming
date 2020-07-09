#!/usr/bin/env python3
from typing import List
import shutil
import glob
import os
import argparse
import subprocess
import re
import time


def get_files(f, args) -> List[str]:
    """
    given a folder will return all the files that are not txt,
    or contain NCOP or NCED. Will also change dir to folder.
    inpt:
        f - string of folder name
        args - argparse object
    oupt:
        list of strings
    """
    os.chdir(f)
    file_list = [
        file
        for file in list(glob.glob("*"))
        if "NCOP" not in file
        and "NCED" not in file
        and ".txt" not in file
        and os.path.isfile(file)
        and os.stat(file).st_size > 100000000  # 100mb
    ]
    sorted_list = sorted(file_list, key=lambda x: re.findall(r"\d\d+|$", x)[0])
    if args.skip:
        sorted_list = sorted_list[args.skip :]
    if args.max:
        sorted_list = sorted_list[: args.max]
    return sorted_list


def stream_file(file, args, streamkey) -> None:
    """
    Create process to stream given file and streamkey
    inpt:
        file - string of file to stream
        args - argparse object
        streamkey - string for angelthump streameky
    """
    clean_file = re.escape(file)
    process = f'ffmpeg -re -i "{clean_file}" -c:v libx264 -pix_fmt yuv420p -preset {args.preset} -b:v 3000k -maxrate 3500k'
    if args.subtrack:
        process += (
            f'-tune animation -vf subtitles="{clean_file}":si={args.subtrack} -map 0:0 '
        )
        if args.audiotrack:
            process += f"-map 0:a:{args.audiotrack} "
        else:
            process += "-map 0:a:0 "
    elif args.subfile:
        process += (
            f'-tune animation -vf subtitles="{re.escape(args.subfile)}":si=0 -map 0:0 '
        )
        if args.audiotrack:
            process += f"-map 0:a:{args.audiotrack} "
        else:
            process += "-map 0:a:0 "
    elif args.audiotrack:
        process += f"-map 0:a:{args.audiotrack} "
    process += "-x264-params keyint=60 -c:a aac -strict 2 -ar 44100 -b:a 160k -ac 2 -bufsize 7000k "
    process += (
        f'-f flv "rtmp://{args.ingest}-ingest.angelthump.com:1935/live/{streamkey}"'
    )
    p = subprocess.Popen(process, shell=True)
    try:
        p.wait()
    except KeyboardInterrupt:
        try:
            p.terminate()
        except OSError:
            pass
        p.wait()
        time.sleep(1)  # let stream end so there isn't a conflict


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("-F", "--folder", help="Folder absolute path")
    parser.add_argument("-f", "--file", help="File absolute path")
    parser.add_argument("-st", "--subtrack", help="Subtitle track")
    parser.add_argument("-sf", "--subfile", help="Subtitle file")
    parser.add_argument("-at", "--audiotrack", help="Audio track")
    parser.add_argument("--skip", type=int, help="Which episode to start at (0 index)")
    parser.add_argument("--max", type=int, help="Final episode # to stream")
    parser.add_argument(
        "--preset",
        default="faster",
        help="ffmpeg '-preset': [ultrafast, superfast, veryfast, faster, fast, medium, slow, veryslow]",
    )
    parser.add_argument(
        "--ingest",
        default="nyc",
        help="Angelthump ingest server to point to: [sgp, lon, fra, blr, ams, nyc, sfo]",
    )
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        raise Exception("ffmpeg is required")

    streamkey = os.environ.get("ANGELTHUMP_STREAM_KEY")
    assert streamkey, "must provide AT stream key as $ANGELTHUMP_STREAM_KEY"
    streamkey = streamkey.strip()
    if args.folder:
        escFolder = args.folder
        files = get_files(escFolder, args)
        for file in files:
            print(file)
            stream_file(file, args, streamkey)
    if args.file:
        file = os.path.abspath(args.file)
        stream_file(file, args, streamkey)

    return 0


if __name__ == "__main__":
    exit(main())
