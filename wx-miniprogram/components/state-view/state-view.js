Component({
  properties: {
    // skeleton | empty | error
    type: { type: String, value: 'empty' },
    text: { type: String, value: '' },
    count: { type: Number, value: 3 }
  },
  data: {
    rows: [1, 2, 3]
  },
  observers: {
    count(n) {
      const rows = [];
      for (let i = 0; i < Math.max(1, parseInt(n, 10) || 1); i++) rows.push(i + 1);
      this.setData({ rows: rows });
    }
  },
  methods: {
    onRetry() {
      this.triggerEvent('retry');
    }
  }
});
