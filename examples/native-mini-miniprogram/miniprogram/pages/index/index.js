Page({
  data: {
    count: 0,
    message: '点击按钮试试点选注释'
  },
  increment() {
    this.setData({ count: this.data.count + 1 });
  }
});
