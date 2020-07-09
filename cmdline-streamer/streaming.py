#!/usr/bin/env python3
from typing import List
from fractions import Fraction
import pathlib
import json
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


def determine_key_interval(filename: str) -> int:
    try:
        data = 2 * Fraction(
            json.loads(
                subprocess.run(
                    [
                        "ffprobe",
                        "-print_format",
                        "json",
                        "-show_format",
                        "-loglevel",
                        "fatal",
                        "-show_streams",
                        filename,
                    ],
                    stdout=subprocess.PIPE,
                ).stdout
            )["streams"][0]["avg_frame_rate"]
        )
    except Exception:
        print(f"failed to determine key int: {data}")
    else:
        return data

    return 0


def format_draw_text(text: str, x: int, y: int) -> str:
    sanitized_text = re.sub(r"/(\:)/g", "\\$1", text)
    sanitized_text = re.sub(r"/\'/g", "", sanitized_text)
    return f'drawtext=text="{sanitized_text}": fontcolor=gray@0.4: fontsize=18: x={x}: y={y}'


def stream_file(file, args, streamkey) -> None:
    """
    Create process to stream given file and streamkey
    inpt:
        file - string of file to stream
        args - argparse object
        streamkey - string for angelthump streameky
    """
    clean_file = pathlib.Path(file)
    process = [
        "ffmpeg",
        "-re",
        "-i",
        f"{clean_file}",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        f"{args.preset}",
        "-b:v",
        f"{args.bitrate}",
        "-maxrate",
        f"{args.bitrate}",
    ]

    filters = []
    if args.show_time:
        filters.append(format_draw_text(time.strftime("%H:%M"), 10, 10))

    if args.title:
        filters.append(format_draw_text(args.title, 10, 36))

    if args.subtrack or args.subfile:
        process += [
            "-tune",
            "animation",
            "-map",
            "0:0",
        ]
        if args.substrack:
            filters.append(f'subtitles="{clean_file}":si={args.subtrack}')
        elif args.subfile:
            filters.append(f'subtitles="{pathlib.Path(args.subfile)}":si=0')

    if len(filters) > 0:
        process += ["-vf", "'" + ",".join(filters) + "'"]

    if args.audiotrack:
        process += ["-map", f"0:a:{args.audiotrack}"]
    else:
        process += ["-map", "0:a:0"]

    keyint = determine_key_interval(file)
    if keyint == 0:
        keyint = 60

    process += [
        "-x264-params",
        f"'keyint={keyint};min-keyint={keyint};no-scenecut'",
        "-c:a",
        "aac",
        "-strict",
        "2",
        "-ar",
        "44100",
        "-b:a",
        "160k",
        "-ac",
        "2",
        "-bufsize",
        "7000k",
        "-f",
        "flv",
        f"'rtmp://{args.ingest}-ingest.angelthump.com:1935/live/{streamkey}'",
    ]

    print(" ".join(process))
    """
    p = subprocess.Popen(" ".join(process), shell=True)
    try:
        p.wait()
    except KeyboardInterrupt:
        try:
            p.terminate()
        except OSError:
            pass
        p.wait()
        time.sleep(1)  # let stream end so there isn't a conflict
    """


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("-F", "--folder", help="Folder absolute path")
    parser.add_argument("-f", "--file", help="File absolute path")
    parser.add_argument("-st", "--subtrack", help="Subtitle track")
    parser.add_argument("-sf", "--subfile", help="Subtitle file")
    parser.add_argument("-at", "--audiotrack", help="Audio track")
    parser.add_argument("-t", "--title", help="Title to add to video feed ")
    parser.add_argument(
        "--show-time", action="store_true", help="add stream start time to video feed"
    )
    parser.add_argument("--skip", type=int, help="Which episode to start at (0 index)")
    parser.add_argument("--max", type=int, help="Final episode # to stream")
    parser.add_argument(
        "-b", "--bitrate", default="3000k", help="ffmpeg bitrate to stream at"
    )
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

    if shutil.which("ffmpeg") is None and shutil.which("ffprobe"):
        raise Exception("ffmpeg and ffprobe is required")

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
