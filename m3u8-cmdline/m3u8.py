import subprocess
import os
import platform
import json
import argparse

class config_info:
  def __init__(self, system):
    if system == 'Windows':
      self.directory = os.getenv('PROGRAMDATA') + '\\m3u8-streamer\\config\\'
    elif system == 'Linux':
      self.directory = os.path.expanduser('~') + '/.config/m3u8-streamer/config/'
    self.os = system
    self.path = self.directory + 'config.json' 

config = config_info(platform.system())


def Initialize(args):
  data = {"streamkey":"",
          "ffmpeg":"ffmpeg -loglevel warning -reconnect 1 -reconnect_at_eof 1 -reconnect_delay_max 10 -i {0} -codec:a aac -c:v copy -f flv rtmp://ingest.angelthump.com:1935/live/{1}"}
  
  if not os.path.isdir(config.directory):
    try:
      os.makedirs(config.directory)   
    except Exception as e:
      print(e)
  if not os.path.isfile(config.path):
    try:
      with open(config.path, 'w') as config_file: json.dump(data, config_file)
    except Exception as e:
      print(e)



def readConfig(args):
  streamkey = None
  ffmpeg = None

  with open(config.path, 'r') as read_file:
    config_JSON_data = json.load(read_file)

    if (config_JSON_data['streamkey'] == '' or config_JSON_data['streamkey'] != str) and args.streamkey == None:
      print('Stream key not found, please use --streamkey flag with your angelthump streamkey to continue')
      exit()
    elif args.streamkey != None:
      with open(config.path, 'w') as write_file:
        config_JSON_data['streamkey'] = args.streamkey
        json.dump(config_JSON_data, write_file)
        streamkey = config_JSON_data['streamkey']
        ffmpeg = config_JSON_data['ffmpeg']

  return streamkey, ffmpeg



def main(data, args):
  streamkey = data[0]
  cmd = data[1].format(args.streamlink, streamkey).split(' ')

  try:
    process = subprocess.Popen(cmd)
    input()
  except KeyboardInterrupt:
    print('Manual break by user')
    process.kill()
    exit()


if __name__ == "__main__":
  parser = argparse.ArgumentParser(description='A tutorial of argparse!')
  parser.add_argument("-sk", "--streamkey", help="Sets config's streamkey. If not called ffmpeg will use config file's streamkey.")
  parser.add_argument("streamlink")
  args = parser.parse_args()
  
  try:
    Initialize(args)
    main(readConfig(args), args)
  except Exception as e:
    print(e)