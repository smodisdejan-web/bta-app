#!/bin/bash
# /mtd-thumbs/<id>.jpg must be public (portal loads it cross-origin); gated pages must still redirect.
#   bash scripts/check-public-thumbs.sh [base]   (default http://localhost:3012)
B=${1:-http://localhost:3012}; f=0
id=$(ls public/mtd-thumbs | head -1 | sed 's/.jpg//')
t=$(curl -s -o /dev/null -w "%{http_code}" "$B/mtd-thumbs/$id.jpg"); [ "$t" = 200 ] && echo "✓ /mtd-thumbs/$id.jpg 200" || { echo "✗ thumbnail $t"; f=1; }
d=$(curl -s -o /dev/null -w "%{http_code}" "$B/mtd-thumbs/"); [ "$d" != 200 ] && echo "✓ /mtd-thumbs/ listing not public ($d)" || { echo "✗ listing 200"; f=1; }
p=$(curl -s -o /dev/null -w "%{http_code}" "$B/overview"); [ "$p" = 307 ] || [ "$p" = 302 ] && echo "✓ /overview still gated ($p)" || { echo "✗ /overview $p"; f=1; }
exit $f
