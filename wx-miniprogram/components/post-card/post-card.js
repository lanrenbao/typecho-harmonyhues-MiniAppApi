Component({
  properties: {
    item: { type: Object, value: {} }
  },
  methods: {
    onTap() {
      this.triggerEvent('tapcard', { cid: this.data.item.cid });
    }
  }
});
