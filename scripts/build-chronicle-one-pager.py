from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
import pypdfium2 as pdfium
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
out = root / 'docs/demo'
pdfmetrics.registerFont(TTFont('Page', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('PageBold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Page', normal='Page', bold='PageBold')
path = out / 'truecost-one-pager-designed.pdf'
c = canvas.Canvas(str(path), pagesize=(1920,1080))
c.setTitle('TrueCost: Why we chose home-loan comparison')
ink, teal, mute, white = '#163D39', '#104B45', '#506560', '#FFFFFF'
def box(x,y,w,h,color):
    c.setFillColor(HexColor(color)); c.rect(x,1080-y-h,w,h,fill=1,stroke=0)
def text(s,x,y,size=30,color=ink,bold=False):
    c.setFillColor(HexColor(color)); c.setFont('PageBold' if bold else 'Page',size)
    c.drawString(x,1080-y-size,s)
def para(s,x,y,w,size=30,color=ink,leading=None):
    p=Paragraph(s,ParagraphStyle('p',fontName='Page',fontSize=size,leading=leading or size*1.4,textColor=HexColor(color)))
    _,h=p.wrap(w,1000); p.drawOn(c,x,1080-y-h); return h
box(0,0,1920,1080,white)
box(0,0,760,1080,teal)
text('TrueCost',68,54,39,white,True)
text('India · Home loans',68,115,24,'#C8E0DA')
text('The rate is only',68,224,67,white,True)
text('part of the cost.',68,306,67,white,True)
para('A lower interest rate can hide higher fees, insurance costs and a longer repayment term.',68,438,610,34,white,48)
text('See the whole decision.',68,662,35,white,True)
para('Compare monthly EMI, fees and total repayment in one view.',68,725,605,32,'#D7E9E4',45)
text('Rajesh & Ritesh',68,951,27,white,True)
text('Buildathon · India pilot',68,996,23,'#C8E0DA')
text('Why we chose this problem',828,60,44,ink,True)
para('A major financial decision, with a focused first product we can build and test.',828,127,990,32,ink,43)
text('Seven ideas. One clear starting point.',828,264,29,ink,True)
para('Insurance and NRI banking needed more trust and compliance work. Community ideas needed operations. PM Workbench served a different buyer.',828,319,990,29,mute,40)
text('What a borrower can do',828,503,40,ink,True)
for x,n,title,body in [(828,'01','Compare','Enter two loan offers as a guest.'),(1174,'02','Understand','See the cost beyond the headline rate.'),(1520,'03','Keep','Sign in to save or download a report.')]:
    text(n,x,584,27,mute)
    text(title,x,629,33,ink,True)
    para(body,x,682,285,28,ink,39)
text('How we will know it helps',828,827,31,ink,True)
para('Track completed comparisons, then saves and report downloads.',828,877,990,28,mute,39)
para('Development demo verified with test inputs. Public release pending.<br/>Team rationale, not validated demand. Estimates, not lender quotes.',828,983,990,21,mute,29)
c.showPage(); c.save()
d=pdfium.PdfDocument(str(path))
assert len(d)==1
assert 'Public release pending' in PdfReader(path).pages[0].extract_text()
d[0].render(scale=2).to_pil().save(out/'truecost-one-pager-designed.png')
print(path)
