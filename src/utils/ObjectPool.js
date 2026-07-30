export class ObjectPool {
  constructor(create, reset, initialSize = 0) {
    this.create = create;
    this.resetItem = reset;
    this.available = [];
    this.all = [];

    for (let index = 0; index < initialSize; index += 1) {
      const item = this.create();
      item.__pooled = true;
      this.all.push(item);
      this.available.push(item);
    }
  }

  acquire() {
    const item = this.available.pop() ?? this.#createItem();
    item.__pooled = false;
    return item;
  }

  release(item) {
    if (!item || item.__pooled) return;
    this.resetItem(item);
    item.__pooled = true;
    this.available.push(item);
  }

  releaseAll() {
    for (const item of this.all) this.release(item);
  }

  #createItem() {
    const item = this.create();
    item.__pooled = false;
    this.all.push(item);
    return item;
  }
}
