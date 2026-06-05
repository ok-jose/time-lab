// 云数据库初始化脚本
// 在小程序云开发控制台执行

// 1. 创建 items 集合
db.createCollection('items');

// 2. 创建 subscriptions 集合
db.createCollection('subscriptions');

// 3. 为 items 创建索引
db.collection('items').createIndex({
  'expireDate': 1,
  'status': 1,
  'createdAt': -1
});

// 4. 为 subscriptions 创建索引
db.collection('subscriptions').createIndex({
  'templateId': 1,
  'createdAt': -1
});

console.log('数据库初始化完成');