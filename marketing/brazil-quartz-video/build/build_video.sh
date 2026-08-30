#!/bin/bash
set -e
cd "$(dirname "$0")"
FF=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
ENC="-c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -r 30 -an"

# Scene 1: intro — hand holding large crystal (trip 0-8.3s)
"$FF" -y -loglevel error -ss 0 -t 8.3 -i media/trip_video.mp4 -i assets/intro_title.png -i assets/watermark.png \
  -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=saturation=1.12:brightness=0.02,unsharp=5:5:0.5,fps=30[v0];[v0][1:v]overlay=0:0[v1];[v1][2:v]overlay,fade=t=in:d=0.6,fade=t=out:st=8.05:d=0.25[v]" \
  -map "[v]" $ENC scenes_s1.mp4

# Scene 2: close-up selection (trip 15-23.2s)
"$FF" -y -loglevel error -ss 15 -t 8.2 -i media/trip_video.mp4 -i assets/cap2.png -i assets/watermark.png \
  -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=saturation=1.12:brightness=0.02,unsharp=5:5:0.5,fps=30[v0];[v0][1:v]overlay=0:0[v1];[v1][2:v]overlay,fade=t=in:d=0.25,fade=t=out:st=7.95:d=0.25[v]" \
  -map "[v]" $ENC scenes_s2.mp4

# Scene 3: wide piles / shipment (trip 45-50.9s)
"$FF" -y -loglevel error -ss 45 -t 5.9 -i media/trip_video.mp4 -i assets/cap3.png -i assets/watermark.png \
  -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,eq=saturation=1.12:brightness=0.02,unsharp=5:5:0.5,fps=30[v0];[v0][1:v]overlay=0:0[v1];[v1][2:v]overlay,fade=t=in:d=0.25,fade=t=out:st=5.65:d=0.25[v]" \
  -map "[v]" $ENC scenes_s3.mp4

# Scene 4: red jasper new items (jasper 2-11.2s), square centered on blurred bg
"$FF" -y -loglevel error -ss 2 -t 9.2 -i media/jasper_video.mp4 -i assets/cap4.png -i assets/watermark.png \
  -filter_complex "[0:v]fps=30,split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=32,eq=brightness=-0.1[bg];[b]scale=1080:1080[fg];[bg][fg]overlay=0:420[v0];[v0][1:v]overlay=0:0[v1];[v1][2:v]overlay,fade=t=in:d=0.25,fade=t=out:st=8.95:d=0.25[v]" \
  -map "[v]" $ENC scenes_s4.mp4

# Scene 5: warehouse slow pan (10.6s)
"$FF" -y -loglevel error -loop 1 -t 10.6 -i flier_imgs/main_p0_1_1104x555.png -i assets/cap5.png -i assets/watermark.png \
  -filter_complex "[0:v]fps=30,split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=36,eq=brightness=-0.12[bg];[b]scale=1400:704[big];[big]crop=1080:543:x='(iw-1080)*t/10.6':y='(ih-543)/2'[fg];[bg][fg]overlay=0:560[v0];[v0][1:v]overlay=0:0[v1];[v1][2:v]overlay,fade=t=in:d=0.25,fade=t=out:st=10.35:d=0.25[v]" \
  -map "[v]" $ENC scenes_s5.mp4

# Scene 6: CTA card (9.3s)
"$FF" -y -loglevel error -loop 1 -t 9.3 -i assets/cta.png \
  -filter_complex "[0:v]fps=30,scale=1080:1920,fade=t=in:d=0.4,fade=t=out:st=8.3:d=1.0[v]" \
  -map "[v]" $ENC scenes_s6.mp4

# Concat
printf "file 'scenes_s1.mp4'\nfile 'scenes_s2.mp4'\nfile 'scenes_s3.mp4'\nfile 'scenes_s4.mp4'\nfile 'scenes_s5.mp4'\nfile 'scenes_s6.mp4'\n" > concat.txt
"$FF" -y -loglevel error -f concat -safe 0 -i concat.txt -c copy video_noaudio.mp4

# Audio mix
python3 mix_audio.py

# Mux
"$FF" -y -loglevel error -i video_noaudio.mp4 -i audio/final_mix.wav -c:v copy -c:a aac -b:a 160k -shortest akay_brazil_quartz.mp4
"$FF" -hide_banner -i akay_brazil_quartz.mp4 2>&1 | grep -E "Duration|Stream"
ls -la akay_brazil_quartz.mp4
