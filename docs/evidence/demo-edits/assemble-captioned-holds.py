import subprocess,os,io,re,sys,textwrap
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(r'C:\Users\RajeshShinde\OneDrive - Electracom Projects (UK) Ltd\Documents\ChatGPT\truecost');ff=r'C:\Program Files\Selects\resources\overlay-renderer\node_modules\@remotion\compositor-win32-x64-msvc\ffmpeg.exe';master=Path(os.environ['TEMP'])/'truecost-motion-holds-master.mp4';wav=root/'docs/evidence/demo-edits/truecost-narration-hosted-development-en-gb-george.wav';srt=root/'docs/evidence/demo-edits/truecost-narration-hosted-development.srt';raw=srt.read_text(encoding='utf-8');cues=[]
for block in re.split(r'\n\s*\n',raw.strip()):
 ls=block.splitlines();
 if len(ls)>=3:
  m=re.match(r'(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)',ls[1]);
  if m:
   v=list(map(int,m.groups())); cues.append((v[0]*3600+v[1]*60+v[2]+v[3]/1000,v[4]*3600+v[5]*60+v[6]+v[7]/1000,' '.join(ls[2:])))
for w,h,name in [(1600,900,'truecost-hosted-development-16x9.partial.mp4'),(720,1280,'truecost-hosted-development-9x16.partial.mp4')]:
 out=root/'docs/evidence/demo-edits'/name;band=170 if w>1000 else 300; font=ImageFont.truetype(r'C:\Windows\Fonts\segoeui.ttf',30 if w>1000 else 24); dec=subprocess.Popen([ff,'-loglevel','error','-i',str(master),'-f','image2pipe','-vcodec','png','-'],stdout=subprocess.PIPE);enc=subprocess.Popen([ff,'-y','-loglevel','error','-f','image2pipe','-vcodec','png','-framerate','25','-i','-','-i',str(wav),'-map','0:v','-map','1:a','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-b:a','160k','-t','180.683','-shortest',str(out)],stdin=subprocess.PIPE);buf=b'';count=0
 while True:
  b=dec.stdout.read(65536)
  if not b: break
  buf+=b
  while True:
   st=buf.find(b'\x89PNG\r\n\x1a\n');
   if st<0: break
   en=buf.find(b'IEND\xaeB`\x82',st)
   if en<0: break
   en+=8; png=buf[st:en];buf=buf[en:];im=Image.open(io.BytesIO(png)).convert('RGB');scale=min(w/1280,(h-band-40)/900);sw,sh=round(1280*scale),round(900*scale);im=im.resize((sw,sh),Image.Resampling.BILINEAR);can=Image.new('RGB',(w,h),(13,57,57));can.paste(im,((w-sw)//2,20));t=count/25;cue=next((c for c in cues if c[0]<=t<c[1]),None)
   if cue:
    wrapped=textwrap.fill(cue[2],width=68 if w>1000 else 30);layer=Image.new('RGBA',(w,band),(8,22,22,230));can.paste(layer,(0,h-band),layer);d=ImageDraw.Draw(can);bb=d.multiline_textbbox((0,0),wrapped,font=font,spacing=6);tw=bb[2]-bb[0];th=bb[3]-bb[1];d.multiline_text(((w-tw)//2,h-band+(band-th)//2),wrapped,font=font,fill='white',spacing=6,align='center')
   bio=io.BytesIO();can.save(bio,format='PNG',compress_level=1);enc.stdin.write(bio.getvalue());count+=1
 dec.stdout.close();dec.wait();enc.stdin.close();rc=enc.wait();print(name,count,rc)
 if rc:sys.exit(rc)

