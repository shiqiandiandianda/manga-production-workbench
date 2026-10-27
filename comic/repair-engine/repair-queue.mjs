// Keep image workers bounded while accepting any number of independent tasks.
export const IMAGE_GENERATION_CONCURRENCY=6;
export class RepairQueue {
  constructor(limit = 2, onError = () => {}) {
    this.limit = limit;
    this.onError = onError;
    this.waiting = new Map();
    this.running = new Set();
  }
  has(id) { return this.waiting.has(id) || this.running.has(id); }
  enqueue(id, work) {
    if (this.has(id)) return false;
    this.waiting.set(id, work);
    this.drain();
    return true;
  }
  cancel(id) { return this.waiting.delete(id); }
  adopt(id, work) {
    if(this.has(id))return false;
    this.running.add(id);
    this.execute(id, work);
    return true;
  }
  execute(id, work) {
    Promise.resolve().then(work).catch(error => this.onError(error, id)).finally(() => {
      this.running.delete(id);
      this.drain();
    });
  }
  drain() {
    while (this.running.size < this.limit && this.waiting.size) {
      const [id, work] = this.waiting.entries().next().value;
      this.waiting.delete(id);
      this.running.add(id);
      this.execute(id, work);
    }
  }
}
