/** Smooth complementary fade: no abrupt slope at the ends. */
export const storyFadeSteps=Object.freeze(Array.from({length:9},(_,i)=>{const offset=i/8;return Object.freeze({offset,amount:offset*offset*(3-2*offset)});}));
