"""Prints an e2e run's results into the job log: failed flows, the keyboard probe's view hierarchy,
and small JPEG copies of key screenshots as base64 (artifacts can't always be downloaded)."""
import base64, glob, io, os, sys, xml.etree.ElementTree as ET

out = sys.argv[1] if len(sys.argv) > 1 else 'e2e-out'

report = os.path.join(out, 'report.xml')
if os.path.exists(report):
    for case in ET.parse(report).iter('testcase'):
        fail = case.find('failure')
        print(f"[{'FAIL' if fail is not None else 'ok'}] {case.get('name')}" + (f" -- {(fail.get('message') or fail.text or '').strip()[:300]}" if fail is not None else ''))

probe = os.path.join(out, 'probe-hierarchy.csv')
if os.path.exists(probe):
    print('===== keyboard probe hierarchy (rows with text, hints, labels or bounds of inputs) =====')
    for line in open(probe, encoding='utf-8', errors='replace'):
        if any(k in line for k in ('text=', 'hintText=', 'accessibilityText=', 'EditText', 'TextField', 'TextView', 'resource-id')):
            print(line.rstrip()[:400])
for name in ('probe-launch.txt', 'probe-ime.txt'):
    p = os.path.join(out, name)
    if os.path.exists(p):
        print(f'===== {name} =====')
        print(open(p, encoding='utf-8', errors='replace').read()[:4000])

try:
    from PIL import Image
except ImportError:
    sys.exit(0)
wanted = ('probe', '03_composer_keyboard', '03_chat_empty', '03_attach_sheet', '03_slash_menu', 'home', 'account', 'optional_designs')
shots = sorted(set(glob.glob(os.path.join(out, '**', '*.png'), recursive=True)))
failed_shown = 0
for path in shots:
    base = os.path.basename(path)
    failed = '❌' in base
    if not (base.startswith(wanted) or failed) or (failed and failed_shown >= 4):
        continue
    failed_shown += failed
    img = Image.open(path).convert('RGB')
    img.thumbnail((320, 720))
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=60)
    print(f'===== IMG {base} {img.size[0]}x{img.size[1]} =====')
    print(base64.b64encode(buf.getvalue()).decode())
