#!/usr/bin/env python3
"""
Word timestamps of the voice-over lines (faster-whisper, model base.en, on this machine):

    python3 scripts/promo/vo-words.py            # .shots/promo/vo/l*.mp3 → .shots/promo/vo/vo.json

vo.json: { "l01.mp3": { "text": …, "words": [{ "w", "s", "e" }] }, … } — assemble.py anchors clips and
the end card on these words. The lines themselves are text-to-speech (see assemble.py for the script).
"""
import glob
import json
import os

from faster_whisper import WhisperModel

VO = '.shots/promo/vo'


def main():
    model = WhisperModel('base.en', device='cpu', compute_type='int8')
    out = {}
    for path in sorted(glob.glob(f'{VO}/l*.mp3')):
        segments, _ = model.transcribe(path, word_timestamps=True, beam_size=5)
        words = []
        text = ''
        for seg in segments:
            text += seg.text
            for w in seg.words or []:
                words.append({'w': w.word.strip(), 's': round(w.start, 3), 'e': round(w.end, 3)})
        name = os.path.basename(path)
        out[name] = {'text': text.strip(), 'words': words}
        print(name, ' '.join(w['w'] for w in words))
    with open(f'{VO}/vo.json', 'w') as f:
        json.dump(out, f, indent=1)


if __name__ == '__main__':
    main()
