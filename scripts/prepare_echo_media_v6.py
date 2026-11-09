"""Prepare credited, openly licensed reference echocardiography cine loops.

Only media URLs observed on their primary publication/catalog pages are used.
The ultrasound clips depict other people; there is no registration or heartbeat
synchronization with the static LADAF-2021-17 specimen. Original annotations and
watermarks are retained. Audio is omitted, native spatial resolution retained
(one black row/column may be padded for H.264), and no frames are synthesized.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import urllib.request

PROJECT = Path(__file__).resolve().parents[1]
POCUS_PAGE = 'https://www.thepocusatlas.com/normal-cardiac-anatomy'
POCUS_LICENSE_PAGE = 'https://www.thepocusatlas.com/legal'
TEE_PAGE = 'https://link.springer.com/article/10.1186/s13089-020-00189-0'
TEE_BASE = 'https://media.springernature.com/original/springer-static/esm/art%3A10.1186%2Fs13089-020-00189-0/MediaObjects/'
POCUS_BASE = 'https://images.squarespace-cdn.com/content/v1/58118909e3df282037abfad7/'

POCUS = [
    ('plax', 'Parasternal long-axis', 'tte-plax.gif',
     '1625940717777-5S50RX08LBAOZPSET7G7/image-asset.gif',
     'Nigist Taddese MBChB — The POCUS Atlas',
     'Normal PLAX reference, described by the contributor as having normal ejection fraction.'),
    ('psax_papillary', 'Parasternal short-axis · papillary level', 'tte-psax.gif',
     '1604501874660-0IU60BXMGI6IPAFZ2YMQ/image-asset.gif',
     'Dr. Felipe Urriola — The POCUS Atlas',
     'Normal parasternal short-axis reference at the papillary muscle level.'),
    ('psax_mitral', 'Parasternal short-axis · mitral to papillary sweep', 'tte-psax-mitral.gif',
     '1533340807311-EOLBMG24ZZ8FW4CUSBY7/parasternal%2Bshort%2Bmitral%2Bnormal.gif',
     'Hannah Kopinski, Dr. Lindsay Davis and Dr. Matthew Riscinti — The POCUS Atlas',
     'This recorded sweep starts at the mitral valve and tilts toward the papillary muscles; its plane changes within the loop.'),
    ('a4c', 'Apical four-chamber', 'tte-a4c.gif',
     '1533340761896-F7CB7JOJRV4HKYLFYT5E/apical%2B4%2Bnormal.gif',
     'Hannah Kopinski and Dr. Lindsay Davis — The POCUS Atlas',
     'Normal apical four-chamber reference with both atrioventricular valves.'),
    ('a2c', 'Apical two-chamber', 'tte-a2c.gif',
     '1515543912261-MX3UJMRSXF12D9US2UT1/ezgif.com-gif-maker%2B%281%29.gif',
     'Justin Bowra MBBS, FACEM, CCPU — The POCUS Atlas',
     'Normal apical two-chamber reference, as identified by the source catalog.'),
    ('subcostal', 'Subcostal four-chamber', 'tte-subcostal.gif',
     '1533340837831-96B9SO0G3BZYRAU7H8F6/subxi%2Bnormal%2B2.gif',
     'Hannah Kopinski, Dr. Lindsay Davis and Dr. Matthew Riscinti — The POCUS Atlas',
     'Normal subcostal four-chamber reference; the liver is visible in the near field.'),
]
TEE = [
    ('me4c', 'Midesophageal four-chamber', 'tee-me4c.wmv', 1, 'wmv', '1a'),
    ('melax', 'Midesophageal long-axis · color Doppler', 'tee-melax.wmv', 2, 'wmv', '1b'),
    ('me2c', 'Midesophageal two-chamber', 'tee-me2c.mp4', 3, 'mp4', '1c'),
    ('bicaval', 'Midesophageal bicaval', 'tee-bicaval.wmv', 4, 'wmv', '1d'),
    ('tgpapillary', 'Transgastric short-axis', 'tee-tgpapillary.mp4', 5, 'mp4', '1e'),
]


def entries():
    result = []
    for key, title, filename, path, author, description in POCUS:
        result.append(dict(id='tte-'+key, mode='tte', preset=key, title=title,
                           filename=filename, downloadUrl=POCUS_BASE+path,
                           sourceUrl=POCUS_PAGE, sourceName='The POCUS Atlas',
                           author=author, description=description,
                           clinicalStatus='Normal reference, according to source',
                           license='CC BY-NC 4.0',
                           licenseUrl='https://creativecommons.org/licenses/by-nc/4.0/',
                           licenseEvidenceUrl=POCUS_LICENSE_PAGE))
    result.append(dict(
        id='tte-a3c', mode='tte', preset='a3c', title='Apical three-chamber',
        filename='tte-a3c.webm',
        downloadUrl='https://upload.wikimedia.org/wikipedia/commons/9/98/A3Cnormal_%28CardioNetworks_ECGpedia%29.avi.webm',
        sourceUrl='https://commons.wikimedia.org/wiki/File:A3Cnormal_(CardioNetworks_ECGpedia).avi.webm',
        sourceName='CardioNetworks / ECHOpedia',
        author='CardioNetworks: Vdbilt (I. A. C. van der Bilt, MD)',
        description='Normal apical three-chamber reference from CardioNetworks / ECHOpedia.',
        clinicalStatus='Normal reference, according to source',
        license='CC BY-SA 3.0', licenseUrl='https://creativecommons.org/licenses/by-sa/3.0/',
        licenseEvidenceUrl='https://commons.wikimedia.org/wiki/File:A3Cnormal_(CardioNetworks_ECGpedia).avi.webm'))
    for key, title, filename, number, extension, supplemental in TEE:
        result.append(dict(
            id='tee-'+key, mode='tee', preset=key, title=title, filename=filename,
            downloadUrl=TEE_BASE+f'13089_2020_189_MOESM{number}_ESM.{extension}',
            sourceUrl=TEE_PAGE, sourceName='The Ultrasound Journal',
            author='Nazerian et al. (2020), The Ultrasound Journal 12:41',
            description=f'Published clinical TEE teaching loop, supplementary video {supplemental}. '+
              ('The source includes color Doppler.' if key=='melax' else 'The source does not designate this individual loop as a normal study.'),
            clinicalStatus='Published clinical teaching loop',
            license='CC BY 4.0', licenseUrl='https://creativecommons.org/licenses/by/4.0/',
            licenseEvidenceUrl=TEE_PAGE, supplementalVideo=supplemental))
    return result


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe','-v','error','-count_frames','-show_entries',
        'stream=codec_type,codec_name,width,height,nb_read_frames,avg_frame_rate:format=duration',
        '-of','json',str(path)]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/workspace/data/echo-media-v6'))
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    out = PROJECT / 'public/assets/echo-media-v6'
    out.mkdir(parents=True, exist_ok=True)
    clips = []
    for entry in entries():
        source = args.cache / entry.pop('filename')
        if not source.exists():
            request = urllib.request.Request(entry['downloadUrl'],headers={'User-Agent':'HeartAtlas-Educational/1.0'})
            with urllib.request.urlopen(request, timeout=60) as response:
                source.write_bytes(response.read())
        original = probe(source)
        original_video = next(x for x in original['streams'] if x['codec_type']=='video')
        target = out / (entry['id']+'.mp4')
        subprocess.run([
            'ffmpeg','-hide_banner','-loglevel','error','-i',str(source),
            '-map','0:v:0','-an','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2',
            '-fps_mode','vfr','-c:v','libx264','-preset','medium','-crf','18',
            '-pix_fmt','yuv420p','-movflags','+faststart','-y',str(target)],check=True)
        prepared = probe(target)
        video = next(x for x in prepared['streams'] if x['codec_type']=='video')
        assert video['codec_name']=='h264'
        assert not any(x['codec_type']=='audio' for x in prepared['streams'])
        assert int(video['nb_read_frames'])>1
        assert int(original_video['nb_read_frames'])==int(video['nb_read_frames']), 'Frames must not be synthesized or discarded'
        duration = float(prepared['format']['duration'])
        poster = out / (entry['id']+'.webp')
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss',str(duration*.35),
                        '-i',str(target),'-frames:v','1','-vf',
                        'scale=640:640:force_original_aspect_ratio=decrease',
                        '-quality','90','-y',str(poster)],check=True)
        # Full decoding is the media integrity check, not just a successful HEAD.
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(target),
                        '-f','null','-'],check=True)
        entry.update(dict(
            url='./assets/echo-media-v6/'+target.name,
            poster='./assets/echo-media-v6/'+poster.name,
            mimeType='video/mp4', width=video['width'],height=video['height'],
            durationSeconds=duration, frames=int(video['nb_read_frames']),
            averageFrameRate=video['avg_frame_rate'],bytes=target.stat().st_size,
            posterBytes=poster.stat().st_size,sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
            sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
            sourceDimensions=[original_video['width'],original_video['height']],
            modifications='Transcoded to silent H.264 MP4; original frames, annotation and spatial detail retained. Odd dimensions padded by at most one black row or column. Poster is a scaled frame.',
            relationshipToScan='Independent person and acquisition; no spatial registration or heartbeat synchronization.'))
        clips.append(entry)
        print(entry['id'],entry['width'],entry['height'],duration,entry['bytes'],flush=True)
    catalog=dict(
        schemaVersion=1, version='echo-media-v6', retrievedDate='2026-11-04',
        relationshipToScan='Independent reference cine; the HiP-CT specimen is static and belongs to another person.',
        matching='Matched by named clinical view only; no patient-specific or pixel registration.',
        autoplay=False, clips=clips,
        unavailable={'meavsax': 'No exact reusable midesophageal aortic-valve short-axis cine was selected. Choose another explicitly named TEE reference or open the ASE view guide.'},
        totalVideoBytes=sum(x['bytes'] for x in clips),
        totalPosterBytes=sum(x['posterBytes'] for x in clips),
    )
    (PROJECT / 'public/assets/echo-media-v6.json').write_text(json.dumps(catalog,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'clips':len(clips),'videoBytes':catalog['totalVideoBytes'],
                      'posterBytes':catalog['totalPosterBytes']}))


if __name__=='__main__':
    main()
