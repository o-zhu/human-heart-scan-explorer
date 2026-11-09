from pathlib import Path
from xml.sax.saxutils import escape
import json

HERE=Path(__file__).resolve().parent
OUT=HERE.parents[1]/'public/assets/tee-atlas/diagrams'
OUT.mkdir(parents=True,exist_ok=True)
views=json.loads((HERE/'canonical-views.json').read_text())
BG='#101a1c'; L='#e59b87'; LF='#543f3b'; R='#78bec7'; RF='#264b55'; A='#e6bd79'; AF='#5a4930'; WALL='#c7c6b4'; TEXT='#edf1e9'; SOFT='#91a6aa'

def path(d, fill='none', stroke=WALL, w=3, extra=''):
    return f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" {extra}/>'
def el(x,y,rx,ry,fill,stroke=None,w=3,extra=''):
    return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="{fill}" stroke="{stroke or fill}" stroke-width="{w}" {extra}/>'
def label(x,y,s,size=14,color=TEXT):
    return f'<text x="{x}" y="{y}" text-anchor="middle" fill="{color}" font-family="Arial, Helvetica, sans-serif" font-size="{size}" font-weight="700">{escape(s)}</text>'
def halo_label(x,y,s,size=14,color=TEXT):
    return label(x,y,s,size,color).replace('<text ', '<text stroke="'+BG+'" stroke-width="3" paint-order="stroke fill" stroke-linejoin="round" ')

def tube(d, color=A, fill=AF,w=22):
    return path(d,'none',color,w)+path(d,'none',fill,w-5)
def valve(x,y,width=21,color=WALL):
    return path(f'M {x-width} {y-3} L {x-3} {y+8} M {x+width} {y-3} L {x+3} {y+8}',stroke=color,w=2.4)
def mercedes(cx,cy,r=20):
    return el(cx,cy,r,r,AF,A,3)+path(f'M {cx} {cy} L {cx} {cy-r+3} M {cx} {cy} L {cx-r*.76:.1f} {cy+r*.48:.1f} M {cx} {cy} L {cx+r*.76:.1f} {cy+r*.48:.1f}',stroke=A,w=2.3)
def lv_sax(cx=125,cy=83,r=43,pap=False,apical=False,mv=False):
    inner=r*(.49 if apical else .74)
    a=el(cx,cy,r,r,LF,L,3.5)+el(cx,cy,inner,inner,BG,L,2)
    if pap:
        a+=el(cx-15,cy+9,5,6,L)+el(cx+15,cy+9,5,6,L)
    if mv:
        a+=path(f'M {cx-22} {cy-3} Q {cx} {cy-20} {cx+22} {cy-3} Q {cx} {cy+14} {cx-22} {cy-3}',BG,L,2.5)
    return a

def rv_crescent(cx=125,cy=83,r=43):
    return path(f'M {cx-28} {cy-r+5} C {cx-89} {cy-r+6}, {cx-91} {cy+r-9}, {cx-28} {cy+r-5} C {cx-61} {cy+18}, {cx-61} {cy-18}, {cx-28} {cy-r+5} Z',RF,R,3)

def four(five=False):
    a=path('M 103 33 C 89 14 52 16 43 37 C 38 48 41 58 53 65 L 105 65 Z',RF,R)
    a+=path('M 112 31 C 135 13 171 21 178 40 C 182 52 175 59 164 65 L 110 65 Z',LF,L)
    a+=path('M 50 67 C 26 85 43 116 95 132 L 105 73 Z',RF,R)
    a+=path('M 114 67 C 114 92 119 130 142 135 C 167 132 187 98 166 68 Z',LF,L)
    a+=valve(77,65,21,R)+valve(142,65,22,L)
    a+=path('M 107 30 L 108 67 L 104 126',stroke=WALL,w=3)
    if five:
        a+=tube('M 113 84 L 115 56 L 105 31',A,AF,15)+label(109,25,'Ao',12,A)
    a+=label(72,47,'RA')+label(144,45,'LA')+label(69,98,'RV')+label(145,104,'LV')
    return a

D={}
D['me5c']=four(True)
D['me4c']=four()
D['mecommissural']=path('M 57 46 C 54 13 164 13 165 46 L 164 62 L 57 62 Z',LF,L)+path('M 56 67 C 50 99 82 131 109 138 C 143 127 175 101 166 67 Z',LF,L)
D['mecommissural']+=path('M 57 62 Q 79 55 92 67 Q 107 83 120 66 Q 143 54 165 62',stroke=L,w=3)+path('M 75 69 L 82 100 M 145 68 L 135 101',stroke=L,w=1.7)+el(82,103,4,7,L)+el(135,104,4,7,L)+label(110,45,'LA')+label(108,113,'LV')+label(185,69,'MV',12,L)
D['me2c']=path('M 80 55 C 57 39 72 18 109 18 C 139 18 149 33 144 55 Z',LF,L)+path('M 143 31 C 158 19 176 23 171 36 L 153 48 L 144 48 Z',LF,L)+path('M 78 61 C 68 92 89 130 112 138 C 140 126 155 88 143 61 Z',LF,L)+valve(111,59,31,L)+el(61,55,7,6,LF,L,2)+label(107,43,'LA')+label(112,105,'LV')+label(174,20,'LAA',11,L)
D['melax']=path('M 82 59 C 67 31 102 12 129 24 C 143 28 147 42 143 58 Z',LF,L)+path('M 80 62 C 64 72 45 104 51 130 C 81 141 122 112 133 82 L 114 61 Z',LF,L)+tube('M 124 80 L 151 62 L 177 46',A,AF,23)+path('M 102 128 C 149 133 177 101 182 73 C 168 83 155 85 142 86 Z',RF,R)+path('M 152 49 L 157 58 M 143 65 L 151 68',stroke=A,w=2.2)+valve(102,58,20,L)+label(110,44,'LA')+label(80,108,'LV')+label(171,38,'Ao',13,A)+label(153,108,'RV',12,R)
D['meavlax']=path('M 41 45 C 47 18 112 15 133 39 L 118 62 L 45 62 Z',LF,L)+path('M 39 71 C 35 86 43 115 81 129 L 111 91 L 105 70 Z',LF,L)+tube('M 83 88 L 129 82 L 183 64',A,AF,28)+path('M 131 68 L 141 78 M 136 91 L 145 80',stroke=A,w=2.7)+path('M 114 103 Q 153 95 188 92 L 187 114 Q 148 122 111 123 Z',RF,R)+label(81,44,'LA')+label(70,111,'LV',12,L)+label(176,79,'Ao',13,A)+label(138,56,'AV',12,A)+label(163,115,'RV',11,R)
D['meaaolax']=tube('M 38 89 C 79 91 133 89 184 77',A,AF,35)+el(111,40,18,14,RF,R)+label(110,45,'PA',12)+label(111,93,'Ao',17,A)+path('M 46 115 L 179 105',stroke=SOFT,w=1,extra='stroke-dasharray="3 5"')
D['meaaosax']=el(111,72,26,26,AF,A,3.5)+el(111,72,20,20,BG,A,1.2)+tube('M 168 106 C 174 76 164 43 137 38 L 54 40',R,RF,19)+el(45,76,15,19,RF,R)+label(111,77,'Ao',15,A)+label(45,81,'SVC',10)+label(163,126,'PA',12,R)+label(82,21,'RPA',11,R)
# Right pulmonary veins: LA mouth nearest the probe and paired venous tributaries.
D['merpv']=path('M 95 39 C 120 22 159 28 166 51 L 169 81 C 163 100 124 105 101 84 Z',LF,L)+tube('M 59 25 L 64 52 L 96 57',L,LF,15)+tube('M 47 91 L 70 83 L 99 76',L,LF,15)+el(43,58,12,13,RF,R)+el(127,124,15,11,AF,A)+label(137,66,'LA')+label(62,16,'RSPV',11,L)+label(55,112,'RIPV',11,L)+label(127,128,'Ao',10,A)
D['meavsax']=path('M 76 41 C 62 15 137 12 150 35 L 142 52 L 79 52 Z',LF,L)+path('M 72 48 C 43 42 27 61 32 87 C 37 106 58 113 78 102 L 85 64 Z',RF,R)+tube('M 71 115 C 115 137 176 120 177 82 L 177 55',R,RF,19)+mercedes(114,80,25)+label(111,37,'LA')+label(54,82,'RA',12)+label(118,116,'RVOT',11,R)+label(179,42,'PA',11,R)
D['mervinout']=path('M 80 40 C 70 12 146 12 154 41 L 146 55 L 87 54 Z',LF,L)+path('M 75 48 C 45 35 23 55 31 77 L 74 82 L 89 63 Z',RF,R)+path('M 34 87 C 38 126 93 144 135 124 C 153 116 167 96 170 72 L 146 69 C 130 91 109 99 88 81 Z',RF,R)+tube('M 160 82 L 173 49 L 178 29',R,RF,20)+el(111,70,15,16,AF,A)+valve(62,82,22,R)+path('M 160 46 L 170 51 M 181 52 L 175 56',stroke=R,w=2.4)+label(115,40,'LA',12)+label(53,66,'RA',12)+label(91,116,'RV')+label(200,40,'PA',11,R)+label(112,74,'Ao',10,A)
D['memodbicaval']=path('M 77 37 C 65 16 144 16 154 39 L 147 51 L 85 51 Z',LF,L)+path('M 61 58 C 72 48 117 50 140 64 C 157 74 144 92 121 99 L 65 97 C 41 91 43 66 61 58 Z',RF,R)+tube('M 27 63 L 56 68',R,RF,18)+tube('M 159 31 L 143 63',R,RF,17)+path('M 128 101 C 147 92 174 91 188 104 C 185 132 153 140 125 130 Z',RF,R)+path('M 127 99 L 141 111 M 161 97 L 147 111',stroke=R,w=2.5)+label(112,39,'LA',12)+label(88,81,'RA')+label(162,123,'RV',12)+label(27,48,'IVC',10,R)+label(176,34,'SVC',10,R)+label(174,90,'TV',11,R)
D['bicaval']=path('M 73 43 C 58 10 152 9 151 44 L 144 57 L 78 57 Z',LF,L)+path('M 52 65 C 86 49 133 55 165 67 L 167 92 C 138 116 79 118 53 94 Z',RF,R)+tube('M 23 77 L 53 77',R,RF,21)+tube('M 166 76 L 197 67',R,RF,21)+path('M 84 108 L 96 134 L 113 113',RF,R,2.5)+path('M 79 57 Q 109 66 146 57',stroke=WALL,w=2.5)+label(111,40,'LA')+label(108,89,'RA')+label(26,58,'IVC',11,R)+label(190,48,'SVC',11,R)+label(165,124,'IAS',11,WALL)+path('M 154 112 L 137 66',stroke=SOFT,w=1.1)
D['mepv']=path('M 110 25 L 110 135',stroke='#2c4145',w=1)+label(55,22,'RIGHT',10,SOFT)+label(166,22,'LEFT',10,SOFT)
D['mepv']+=path('M 29 65 C 40 51 74 53 83 70 L 80 111 C 65 124 37 116 29 103 Z',LF,L)+tube('M 75 35 L 73 63',L,LF,12)+tube('M 15 93 L 30 83',L,LF,12)+label(57,92,'LA',13)+label(91,43,'S',10,L)+label(15,112,'I',10,L)
D['mepv']+=path('M 136 65 C 149 50 180 54 191 70 L 187 111 C 173 123 144 116 136 102 Z',LF,L)+tube('M 179 35 L 178 62',L,LF,12)+tube('M 120 94 L 137 83',L,LF,12)+label(164,92,'LA',13)+label(194,43,'S',10,L)+label(122,112,'I',10,L)
D['melaa']=path('M 50 65 C 66 44 121 42 150 63 L 150 105 C 120 130 68 120 48 97 Z',LF,L)+path('M 132 63 C 139 39 148 22 164 22 C 176 23 172 35 166 42 C 184 29 198 38 190 51 C 181 67 158 76 150 80 Z',LF,L)+tube('M 69 23 L 81 53',L,LF,18)+path('M 108 45 Q 124 55 131 66',stroke=WALL,w=4)+path('M 157 45 L 164 54 M 165 38 L 172 46 M 173 49 L 179 55',stroke=L,w=1.8)+label(95,89,'LA',17)+label(168,91,'LAA',14,L)+label(64,17,'LSPV',11,L)
D['tgbasalsax']=rv_crescent()+lv_sax(mv=True)+halo_label(54,86,'RV',12,R)+label(125,62,'LV',12,L)+label(125,111,'MV',13,L)
D['tgpapillary']=rv_crescent()+lv_sax(pap=True)+halo_label(54,86,'RV',12,R)+label(125,74,'LV',14,L)+label(125,137,'PAPILLARY',9,SOFT)
D['tgapicalsax']=rv_crescent(127,82,32)+lv_sax(127,82,39,apical=True)+label(127,87,'LV',14,L)+halo_label(54,88,'RV',11,R)
D['tgrvbasal']=path('M 50 59 C 53 35 74 23 99 27 L 157 31 L 166 49 L 116 51 C 99 53 92 67 90 81 Z',RF,R)+path('M 65 60 C 37 74 48 119 92 131 C 133 134 169 111 170 83 C 146 60 109 51 65 60 Z',RF,R)+path('M 75 86 Q 104 62 143 83 L 116 104 Z',BG,R,2.7)+path('M 116 104 L 103 77',stroke=R,w=2)+label(113,119,'RV',13)+label(114,90,'TV',11,R)+label(133,23,'RVOT',12,R)
D['tgrvinout']=path('M 138 32 C 158 18 191 31 190 56 L 183 71 L 137 70 Z',RF,R)+path('M 53 84 C 65 115 104 138 147 120 C 166 113 181 94 179 76 L 140 73 C 115 99 97 88 86 70 Z',RF,R)+tube('M 64 91 L 52 61 L 43 34',R,RF,24)+path('M 40 61 L 53 65 M 63 56 L 56 65',stroke=R,w=2.5)+valve(158,70,20,R)+label(163,54,'RA')+label(119,115,'RV')+label(47,23,'PA',12,R)+label(28,73,'PV',11,R)+label(191,85,'TV',11,R)
# Deep transgastric: the ventricular apex is nearest the transducer.
D['deeptg5c']=path('M 117 18 C 83 31 76 67 92 97 L 143 99 C 160 70 147 32 117 18 Z',LF,L)+path('M 96 24 C 52 41 39 69 54 96 L 83 94 C 74 66 81 42 96 24 Z',RF,R)+path('M 95 105 C 87 126 106 139 126 136 C 147 135 156 119 145 105 Z',LF,L)+path('M 49 103 C 32 115 47 133 67 133 C 83 132 89 114 81 103 Z',RF,R)+tube('M 99 91 L 84 112 L 88 135',A,AF,13)+valve(120,102,24,L)+valve(65,100,16,R)+label(118,64,'LV')+label(61,72,'RV',12)+label(124,126,'LA',12)+label(63,125,'RA',11)+label(174,136,'Ao',11,A)+path('M 161 132 L 98 129',stroke=SOFT,w=1)
D['tg2c']=path('M 27 78 C 56 40 107 29 145 50 L 146 102 C 111 122 58 115 27 78 Z',LF,L)+path('M 155 48 C 179 34 202 53 198 81 C 196 105 175 115 156 101 Z',LF,L)+path('M 148 49 L 137 73 M 148 103 L 137 82',stroke=L,w=2.8)+path('M 135 72 L 109 60 M 136 83 L 109 100',stroke=L,w=1.6)+el(105,60,6,4,L)+el(105,101,6,4,L)+label(87,84,'LV',17)+label(177,82,'LA')+label(158,127,'MV',11,L)
D['tgrvin']=path('M 27 79 C 48 48 102 31 144 50 L 145 103 C 108 127 54 116 27 79 Z',RF,R)+path('M 156 48 C 181 33 204 52 199 79 C 197 105 174 116 156 103 Z',RF,R)+path('M 148 49 L 136 70 M 148 104 L 137 82',stroke=R,w=2.7)+path('M 136 70 L 105 63 M 137 82 L 106 99',stroke=R,w=1.6)+el(102,63,5,4,R)+el(102,99,5,4,R)+label(87,84,'RV',17)+label(177,83,'RA')+label(158,128,'TV',11,R)
D['tglax']=path('M 25 75 C 50 39 102 29 132 48 L 144 88 C 120 118 59 118 25 75 Z',LF,L)+path('M 148 91 C 164 88 183 100 182 117 C 177 139 150 142 134 126 L 132 104 Z',LF,L)+tube('M 124 63 L 156 54 L 192 39',A,AF,24)+path('M 154 41 L 162 51 M 160 67 L 166 55',stroke=A,w=2.5)+path('M 137 96 L 151 105 M 133 115 L 148 112',stroke=L,w=2.5)+label(85,80,'LV',17)+label(159,124,'LA',12)+label(183,68,'Ao',13,A)+label(167,23,'AV',11,A)
D['daosax']=el(110,80,43,43,AF,A,4)+el(110,80,35,35,BG,A,1.5)+label(110,87,'Ao',21,A)
D['daolax']=tube('M 30 78 C 75 70 145 70 190 77',A,AF,40)+path('M 36 58 Q 110 46 184 58',stroke=A,w=1.4)+path('M 36 98 Q 111 91 184 97',stroke=A,w=1.4)+label(111,84,'Ao',20,A)
D['uearchlax']=tube('M 32 108 C 51 64 76 55 113 61 C 147 65 170 64 190 62',A,AF,31)+label(115,100,'AORTIC ARCH',13,A)+path('M 35 130 Q 75 110 105 120',stroke=SOFT,w=1,extra='stroke-dasharray="3 5"')
D['uearchsax']=el(111,43,28,24,AF,A,3.5)+el(111,43,21,18,BG,A,1.2)+tube('M 42 113 C 82 112 118 107 155 88 L 182 79',R,RF,25)+path('M 146 81 L 154 91 M 156 103 L 161 94',stroke=R,w=2.5)+label(111,48,'Ao',15,A)+label(99,119,'MPA',14,R)+label(172,119,'PV',11,R)

source='https://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf'
manifest=[]
for v in views:
    ident=v['id']; n=v['aseNumber']; name=v['name']; body=D[ident]
    desc=f'Original simplified teaching schematic of {name}. Warm coral indicates left-heart anatomy; cyan indicates right-heart anatomy; amber indicates aorta. It is not patient-specific anatomy or ultrasound.'
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="220" height="150" viewBox="0 0 220 150" role="img" aria-labelledby="title-{ident} desc-{ident}">\n<title id="title-{ident}">{escape(name)}</title>\n<desc id="desc-{ident}">{escape(desc)}</desc>\n<rect width="220" height="150" rx="10" fill="{BG}"/>\n<path d="M 35 138 Q 110 149 195 137" fill="none" stroke="#24363a" stroke-width="1"/>\n{body}\n</svg>'''
    (OUT/f'{ident}.svg').write_text(svg)
    manifest.append({'id':ident,'aseNumber':n,'name':name,'group':v['group'],'file':f'{ident}.svg','src':f'/assets/tee-atlas/diagrams/{ident}.svg','landmarks':v.get('anatomy',[]),'description':desc,'source':source,'originalArtwork':True})
(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2))
(HERE/'README.md').write_text('''# Heart Explorer — original TEE view schematics\n\n28 original SVG teaching diagrams for the ASE/SCA 2013 comprehensive examination, Table 10: 15 midesophageal, 9 transgastric, and 4 aortic views. Each SVG has a 220×150 viewBox, descriptive title/description, and original vector geometry.\n\n## Integration\n\nCopy the 28 SVG files to `public/assets/tee-atlas/diagrams/`. `manifest.json` maps canonical view IDs, ordering, labels, and intended public paths. Legacy IDs are preserved. The Python generator is the editable source.\n\n## Visual conventions\n\nCoral = left heart; cyan = right heart; amber = aorta. Chamber labels and a few distinguishing structures provide navigation recognition. The cartoons use simplified standard echo display relationships, not measured patient geometry or synthetic ultrasound. Multi-plane positioning varies with anatomy; the view definition comes from structures visible in the plane. The pulmonary-vein card intentionally shows separate right/left panels.\n\n## Source and attribution\n\nAnatomical targets and standard view names follow Hahn et al., Guidelines for Performing a Comprehensive Transesophageal Echocardiographic Examination, JASE 2013;26:921–964, Table 10. DOI: 10.1016/j.echo.2013.07.009.\n\nhttps://www.asecho.org/wp-content/uploads/2014/05/2013_Performing-Comprehensive-TEE.pdf\n\nThe drawings are newly authored schematic artwork, not reproduced guideline figures. They are educational navigation aids and should not be used as a clinical acquisition or diagnostic reference on their own.\n''')
print(json.dumps({'created':len(manifest),'directory':str(OUT),'samples':['me4c.svg','meavsax.svg','tgpapillary.svg','uearchlax.svg']}))
