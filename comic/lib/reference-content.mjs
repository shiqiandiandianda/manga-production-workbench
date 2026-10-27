import fs from 'node:fs';import {createHash} from 'node:crypto';import {localImagePath} from './image-files.mjs';
// Project archiving can relocate a fixed image without changing the reference.
export function referenceContentStamp(files){return 'sha256:'+createHash('sha256').update(JSON.stringify(files.map(file=>createHash('sha256').update(fs.readFileSync(localImagePath(file))).digest('hex')))).digest('hex');}
