from pathlib import Path
import re
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1]
source = root / 'docs/demo-one-pager.md'
output = root / 'docs/demo-one-pager-review.pdf'
pdfmetrics.registerFont(TTFont('ReviewSans', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ReviewSansBold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('ReviewSans', normal='ReviewSans', bold='ReviewSansBold')
body = ParagraphStyle('body', fontName='ReviewSans', fontSize=11.2, leading=15.6, textColor=HexColor('#243c39'), spaceAfter=10)
heading = ParagraphStyle('heading', parent=body, fontName='ReviewSansBold', fontSize=14, leading=18, spaceBefore=16, spaceAfter=8, textColor=HexColor('#0a625c'), keepWithNext=True)
title = ParagraphStyle('title', parent=heading, fontSize=38, leading=42, spaceBefore=0, spaceAfter=12)
small = ParagraphStyle('small', parent=body, fontSize=8, leading=10)

def markup(text):
    text = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', lambda m: f'{m[1]} ({m[2]})', text)
    text = escape(text.replace('`', ''))
    return re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)

story = []
for block in source.read_text(encoding='utf-8-sig').strip().split('\n\n'):
    if block.startswith('# '):
        story.append(Paragraph(markup(block[2:]), title))
    elif block.startswith('## '):
        story.append(Paragraph(markup(block[3:]), heading))
    elif block.startswith('- '):
        for line in block.splitlines():
            story.append(Paragraph('• ' + markup(line[2:]), body))
    else:
        story.append(Paragraph(markup(block.replace('\n', ' ')), body))

def footer(c, doc):
    c.setFont('ReviewSans', 7)
    c.setFillColor(HexColor('#526863'))
    c.drawString(48, 25, 'Review draft · Team rationale retained in the detailed source document.')

SimpleDocTemplate(str(output), pagesize=A4, rightMargin=48, leftMargin=48, topMargin=40, bottomMargin=45).build(story, onFirstPage=footer, onLaterPages=footer)
reader = PdfReader(output)
assert len(reader.pages) == 1, f'Expected one page; got {len(reader.pages)}'
text = ' '.join(reader.pages[0].extract_text().split())
assert 'seven team ideas' in text and 'Compare two offers as a guest.' in text and 'public release is pending' in text
print(f'Created one-page review PDF: {output} ({output.stat().st_size} bytes)')
