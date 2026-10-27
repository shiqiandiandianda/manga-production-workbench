/** A reflow result owns one rendered episode even when its source package contains more. */
export function reflowEpisodeNumber(project,fallback){
 const fixed=project?.autoLayoutSource?.mode==='screen-crop-reflow'?Number(project.autoLayoutSource.episode):null;
 const numbers=project?.productionPackage?.episodes.map(e=>Number(e.episode))||[];
 if(Number.isInteger(fixed)&&numbers.includes(fixed))return fixed;
 const requested=Number(fallback);return numbers.includes(requested)?requested:numbers[0]||requested;
}
export function availableReflowEpisodes(project){
 const episodes=project?.productionPackage?.episodes||[];
 return project?.autoLayoutSource?.mode==='screen-crop-reflow'?episodes.filter(e=>Number(e.episode)===Number(project.autoLayoutSource.episode)):episodes;
}
