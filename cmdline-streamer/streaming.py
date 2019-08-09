#!/usr/bin/python3
import glob
import os
import argparse
import subprocess
import re
import time


def get_files(f, args):
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
    #print(list(glob.glob("*")))
    file_list = [
        file
        for file in list(glob.glob("*"))
        if "NCOP" not in file
        and "NCED" not in file
        and ".txt" not in file
        and os.path.isfile(file)
        and os.stat(file).st_size > 100000000 # 100mb
    ]
    sorted_list = sorted(file_list, key=lambda x: re.findall(r"\d\d+|$", x)[0])
    if args.skip:
        sorted_list = sorted_list[args.skip :]
    if args.max:
        sorted_list = sorted_list[: args.max]
    return sorted_list


def stream_file(file, args, streamkey):
    """
    Create process to stream given file and streamkey
    inpt:
        file - string of file to stream
        args - argparse object
        streamkey - string for angelthump streameky
    """
    clean_file = re.escape(file)
    process = 'ffmpeg -re -i "{0}" -c:v libx264 -pix_fmt yuv420p -preset faster -b:v 3000k -maxrate 3500k '.format(
        file
    )
    if args.subtrack:
        process += '-tune animation -vf subtitles="{0}":si={1} -map 0:0 '.format(
            clean_file, args.subtrack
        )
        if args.audiotrack:
            process += "-map 0:a:{} ".format(args.audiotrack)
        else:
            process += "-map 0:a:0 "
    elif args.subfile:
        process += '-tune animation -vf subtitles="{0}":si=0 -map 0:0 '.format(
            re.escape(args.subfile)
        )
        if args.audiotrack:
            process += "-map 0:a:{} ".format(args.audiotrack)
        else:
            process += "-map 0:a:0 "
    elif args.audiotrack:
        process += "-map 0:a:{} ".format(args.audiotrack)
    process += "-x264-params keyint=60 -c:a aac -strict 2 -ar 44100 -b:a 160k -ac 2 -bufsize 7000k "
    process += '-f flv "rtmp://nyc-ingest.angelthump.com:1935/live/{0}"'.format(
        streamkey
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


def main(args):
    with open("angelthumpkey", "r") as f:
        streamkey = f.read()
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
    pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("-F", "--folder", help="Folder absolute path")
    parser.add_argument("-f", "--file", help="File absolute path")
    parser.add_argument("-st", "--subtrack", help="Subtitle track")
    parser.add_argument("-sf", "--subfile", help="Subtitle file")
    parser.add_argument("-at", "--audiotrack", help="Audio track")
    parser.add_argument("--skip", type=int, help="Which episode to start at (0 index)")
    parser.add_argument("--max", type=int, help="Final episode # to stream")
    args = parser.parse_args()
    main(args)
