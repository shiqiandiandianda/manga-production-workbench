export const DEFAULT_NEGATIVE_PROMPT='';
export function resolveNegativePrompt(value){return typeof value?.negativePrompt==='string'?value.negativePrompt:'';}
export function negativePromptInstructions(value){return resolveNegativePrompt(value);}
