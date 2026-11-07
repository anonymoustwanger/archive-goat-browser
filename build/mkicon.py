import sys
from PIL import Image, ImageDraw
out=sys.argv[1]
S=1024
img=Image.new('RGBA',(S,S),(0,0,0,0))
d=ImageDraw.Draw(img)
d.rounded_rectangle([40,40,S-40,S-40],radius=220,fill=(16,18,20,255))
acc=(95,211,179,255); wh=(236,238,240,255)
d.arc([150,170,520,540],start=180,end=300,fill=acc,width=70)
d.arc([504,170,874,540],start=240,end=360,fill=acc,width=70)
d.polygon([(330,400),(694,400),(640,640),(512,760),(384,640)],fill=wh)
d.ellipse([330,360,694,520],fill=wh)
d.polygon([(330,430),(200,470),(320,520)],fill=wh)
d.polygon([(694,430),(824,470),(704,520)],fill=wh)
d.polygon([(470,740),(554,740),(512,880)],fill=wh)
d.ellipse([410,470,462,522],fill=(16,18,20,255)); d.ellipse([562,470,614,522],fill=(16,18,20,255))
img.resize((256,256),Image.LANCZOS).save(out+'/src/icon.png')
img.save(out+'/build/icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
