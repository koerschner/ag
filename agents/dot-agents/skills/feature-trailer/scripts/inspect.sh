#!/usr/bin/env bash
# Inventory clips before planning shots: duration/size, a labeled contact sheet (<=1500px JPEG,
# safe to read into context), and the moments with the most on-screen change (action candidates).
#   inspect.sh <out_dir> <clip>... [--every SECONDS]
set -euo pipefail
out=$1; shift
every=""
clips=()
while (($#)); do
  case $1 in --every) every=$2; shift 2 ;; *) clips+=("$1"); shift ;; esac
done
mkdir -p "$out"
font=$(ls /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf ~/.fonts/*.ttf /System/Library/Fonts/Supplemental/Arial\ Bold.ttf 2>/dev/null | head -1 || true)
for c in "${clips[@]}"; do
  name=$(basename "${c%.*}")
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$c")
  size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$c")
  audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$c" | head -1)
  step=${every:-$(python3 -c "print(max(1, round($dur/40, 1)))")}
  n=$(python3 -c "import math; print(max(1, math.ceil($dur/$step)))")
  rows=$(( (n + 7) / 8 ))
  label=""
  [ -n "$font" ] && label=",drawtext=fontfile='$font':text='%{pts\\:hms}':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6"
  ffmpeg -v error -y -i "$c" -vf "fps=1/$step,scale=180:-2$label,tile=8x$rows:padding=3" -frames:v 1 -q:v 4 "$out/$name-sheet.jpg"
  # on-screen change per second (scene score summed at 5 fps): the 12 busiest seconds = action candidates
  peaks=$(ffmpeg -v error -i "$c" -vf "fps=5,scale=320:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file=-" -f null - 2>&1 \
    | paste - - | awk '{split($3,a,":"); split($4,b,"="); s[int(a[2])]+=b[2]} END {for (k in s) print k, s[k]}' \
    | sort -k2 -gr | head -12 | sort -n | awk '{printf "%ds(%.2f) ", $1, $2}')
  echo "$name  ${dur%.*}s  $size  audio=${audio:-none}  sheet=$out/$name-sheet.jpg (every ${step}s)"
  echo "  busiest: $peaks"
done
