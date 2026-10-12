/**
 * Animated GIFs from Wikimedia Commons that are in the public domain or CC0, so they can be shared
 * and uploaded to a keyboard without conditions. Each was checked against the Commons licence
 * metadata when it was added, cropped or letterboxed to 128×128 and reduced to at most 48 frames;
 * the originals are linked below. Listed in THIRD_PARTY.md.
 */
export interface PublicGif {
  id: string;
  name: string;
  file: string;
  frames: number;
  loopMs: number;
  license: 'Public domain' | 'CC0';
  author: string;
  source: string;
}

const COMMONS = 'https://commons.wikimedia.org/wiki/File:';

export const PUBLIC_GIFS: readonly PublicGif[] = [
  {
    id: 'cat-tail',
    name: 'Cat with a waving tail',
    file: 'cat-tail.gif',
    frames: 2,
    loopMs: 1000,
    license: 'Public domain',
    author: 'GeeAlice',
    source: `${COMMONS}Cat_tail_ani.gif`,
  },
  {
    id: 'cat-1919',
    name: 'Cartoon cat, 1919',
    file: 'cat-1919.gif',
    frames: 45,
    loopMs: 16080,
    license: 'Public domain',
    author: 'Pat Sullivan (Feline Follies, 1919)',
    source: `${COMMONS}Animated_GIF_from_the_1919_Feline_folies_by_Pat_Sullivan.gif`,
  },
  {
    id: 'heart',
    name: 'Heart',
    file: 'heart.gif',
    frames: 6,
    loopMs: 600,
    license: 'Public domain',
    author: 'Filthy cat',
    source: `${COMMONS}Animated_heart5.gif`,
  },
  {
    id: 'dog',
    name: 'Galloping dog',
    file: 'dog.gif',
    frames: 5,
    loopMs: 750,
    license: 'Public domain',
    author: 'Eadweard Muybridge; animation by Waugsberg',
    source: `${COMMONS}Dog_galloping.gif`,
  },
  {
    id: 'race-horse',
    name: 'Race horse',
    file: 'race-horse.gif',
    frames: 15,
    loopMs: 1500,
    license: 'Public domain',
    author: 'Eadweard Muybridge',
    source: `${COMMONS}Muybridge_race_horse_animated.gif`,
  },
  {
    id: 'earth',
    name: 'Earth from space',
    file: 'earth.gif',
    frames: 21,
    loopMs: 10500,
    license: 'Public domain',
    author: 'NASA / DSCOVR EPIC',
    source: `${COMMONS}Earth-EpicDay260-20150917_(cropped).gif`,
  },
  {
    id: 'globe',
    name: 'Rotating globe',
    file: 'globe.gif',
    frames: 36,
    loopMs: 11360,
    license: 'Public domain',
    author: 'NOAA NCEI base data',
    source: `${COMMONS}Rotating_globe_s.gif`,
  },
  {
    id: 'newton',
    name: 'Newton’s cradle',
    file: 'newton.gif',
    frames: 19,
    loopMs: 2560,
    license: 'CC0',
    author: 'Rhetos',
    source: `${COMMONS}Klassische_Physik_(Newtonpendel).gif`,
  },
  {
    id: 'tesseract',
    name: 'Rotating tesseract',
    file: 'tesseract.gif',
    frames: 48,
    loopMs: 3360,
    license: 'Public domain',
    author: 'Jason Hise',
    source: `${COMMONS}8-cell-simple.gif`,
  },
  {
    id: 'hurricane',
    name: 'Hurricane from space',
    file: 'hurricane.gif',
    frames: 15,
    loopMs: 2600,
    license: 'Public domain',
    author: 'NOAA',
    source: `${COMMONS}Harvey_Rainbow_20170825_2345_UTC.gif`,
  },
  {
    id: 'zoetrope',
    name: 'Zoetrope birds',
    file: 'zoetrope.gif',
    frames: 10,
    loopMs: 1000,
    license: 'Public domain',
    author: 'Library of Congress (19th-century optical toy)',
    source: `${COMMONS}Optical_illusion_disc_with_birds,_butterflies,_and_a_man_jumping-Corrected.gif`,
  },
];

export const gifUrl = (g: PublicGif): string => `./gallery/${g.file}`;
