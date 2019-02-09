Plex Bot
========

## Getting started

#### Configure your bot

1. Follow [this guide](https://support.plex.tv/articles/203948776-managed-users/) to create a manged plex user for your bot.
2. Fill in the Plex config settings in your `.env` ex:
    ```yml
    PLEX_HOST=192.168.0.101
    PLEX_USER=myPlexUser
    PLEX_PASSWORD=myPlexPassword
    PLEX_MANAGED_USER=myBotUser
    ```

3. Create an [AngelThump account](https://angelthump.com/signup)
4. Find your stream key and the ingest server nearest to you on [the settings page](https://angelthump.com/dashboard/settings)
5. Fill in the AngelThump config settings. The ingest config setting should be the selected ingest URL, a slash, then your stream key.
    ```
    ANGELTHUMP_INGEST=rtmp://nyc-ingest.angelthump.com:1935/live/7h1515n074r34157r34mk3y
    ANGELTHUMP_USER=myBotUser
    ANGELTHUMP_PASSWORD=myBotPassword
    ```

6. Choose a preset and tune from [the available values](https://trac.ffmpeg.org/wiki/Encode/H.264#a2.Chooseapresetandtune) appropriate for your hardware and the content your bot streams. These are set to `veryfast` and `zerolatency` by default.

    ```yml
    ENCODER_PRESET=medium
    ENCODER_TUNE=animation
    ```

7. Bot picks content from your Plex library based on similarity to the last thing it played. Similarity is determined by the number of overlaps in directors, writers, actors, genres, film locations, and the year it was released.

    Setting a value to zero will cause it to be ignored and negative values will make content overlapping on a dimension less likely to play than non-matching content.
    ```yml
    DIRECTOR_WEIGHT=10
    GENRE_WEIGHT=1
    WRITER_WEIGHT=10
    COUNTRY_WEIGHT=1
    ROLE_WEIGHT=5
    YEAR_WEIGHT=5
    ```

8. Set your time zone. This is baked into the broadcast in the top left corner after the start timestamp.
    ```yml
    TIME_ZONE=Eastern
    ```

#### Prepare your system

9. Ensure that the Plex library is available on the computer where your bot runs **at the same path**. If your bot is running on the same computer as your Plex server you're all set. Otherwise you may need to mount the media directory using NFS/SMB/etc.

10. Install node.js: https://nodejs.org/en/download/package-manager/

11. Install ffmpeg: https://linuxize.com/post/how-to-install-ffmpeg-on-ubuntu-18-04/

#### Install and run the bot

12. Install the node dependencies
    ```bash
    $ cd plex-bot
    $ npm install
    ```

13.  Running the bot with `runner.sh` will allow it to "recover" from failures (the bot itself doesn't right now).

#### Maintain the bot

Previously played media ids are stored in `history.json` in the bot's root directly. This will eventually fill up with all of the matching media in your plex library and the bot will crash loop until you clear it out.
