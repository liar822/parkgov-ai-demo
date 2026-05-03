# 校园试点 AI 验证记录

## 验证目标

本记录用于说明 ParkGov AI 在“北京高校校园东门试点停车场”上的样例 AI 闭环：

图片样例 -> ROI 车位区域 -> 模型推理 -> 标准 inference JSON -> `inference_events` -> `parking_slots` -> 用户端余位与到场保障变化。

该验证只用于挑战杯 MVP 工程演示，不代表已接入真实校园摄像头、真实保卫处系统或全北京实时摄像头。

## 样例来源

- 停车场：北京高校校园东门试点停车场
- 停车场来源编号：`BJU_CAMPUS_DEMO_001`
- 摄像头来源编号：`CAMERA_CAMPUS_DEMO_001`
- 样例输入：`datasets/samples/campus/east-gate-synthetic-frame.png`
- 样例性质：合成校园停车场画面，用于验证 ROI 和写回链路，不是真实校园监控画面。
- ROI 文件：`data/campus_parking_slot_roi_demo.csv`
- ROI 数量：24 个车位 ROI
- ROI 版本：`demo_v1`

## 模型与训练来源

- 模型名称：`campus_synthetic_cnrpark_ext_30k_epoch3`
- 权重路径：`external_repos/primary_ai_parking_system/ai-services/training_runs/cnrpark_ext_30k_epoch3/cnrpark_ext_slot_cnn_best.pt`
- 训练数据：CNRPark+EXT 公开数据集 patch 样本
- 训练规模：30,000 训练样本，6,000 验证样本，6,000 测试样本
- 测试集指标：
  - accuracy：0.9718
  - occupied F1：0.9740
  - vacant F1：0.9693
- 数据边界：CNRPark+EXT 不是北京校园数据，只用于公开数据集训练验证。

## 运行命令

```bash
cd /Users/liguangcheng/Documents/New\ project\ 2/external_repos/primary_ai_parking_system/backend

npm run demo:ai-infer:campus-synthetic -- --dry-run
npm run demo:ai-infer:campus-synthetic
```

## 本轮运行结果

运行时间：2026-05-01

页面更新：2026-05-01 已将 `/admin/video` 调整为首屏展示“公开数据集训练”和“校园样例验证”双证据摘要；用户端 `/parking-lots` 以 AI 首选、地图、Plan B/Plan C 和到场码作为主服务流。

dry-run 结果：

- 成功连接 PostgreSQL。
- 成功找到停车场 `北京高校校园东门试点停车场`。
- 成功找到摄像头源 `CAMERA_CAMPUS_DEMO_001`。
- 成功读取 24 个 ROI。
- 成功定位样例图片与 CNRPark+EXT 30k 模型权重。
- dry-run 未写入数据库。

真实写回结果：

- 新增 AI 处理任务：`ai_processing_jobs.id = 14`
- 新增识别事件：`inference_events.id = 11`
- 输入图片：`datasets/samples/campus/east-gate-synthetic-frame.png`
- ROI 数量：24
- 推理模式：image
- 模型：`campus_synthetic_cnrpark_ext_30k_epoch3`
- 总车位：24
- 识别占用：24
- 识别空闲：0
- 平均置信度：1.0000
- 写回车位数：24

本次合成图中的 ROI 均被模型判定为占用。该结果说明链路已经能够完成“模型输出 -> 标准 JSON -> 数据库写回”，但不应被解释为真实校园现场占用率。

管理端展示口径：

- 校园样例验证：展示任务 ID、事件 ID、24 个 ROI、模型版本、输入来源和写回车位数。
- 公开数据集训练：展示 CNRPark+EXT 30k 训练指标和模型路径。
- 最近 AI 事件：展示事件影响的停车场、识别车位数、占用/空闲数量和平均置信度。

用户端展示口径：

- `/parking-lots` 不展示“真实校园摄像头接入”，只把本次写回结果作为 AI 到场保障 demo 信号。
- 地图首页继续以 AI 首选、Plan B、外部导航和到场码为服务主线。
- 到场码仍是演示凭证，不锁位、不扣款、不代表真实预约。

## 当前局限

- 样例图是合成图，不是真实校园摄像头画面。
- ROI 仍是 demo 标注，适合演示闭环，不代表最终生产标注质量。
- CNRPark+EXT 模型来自公开停车场 patch 数据，尚未做北京校园真实图片微调。
- 本次验证只覆盖单张图片，短视频多帧投票能力已经在脚本中预留，但仍需要后续校园非敏感短视频样例验证。
- 到场保障概率是 MVP 评分，不是生产级预测服务。

## 下一步建议

1. 采集或制作一段更接近校园东门视角的非敏感短视频样例。
2. 将 ROI 扩展到 20-30 个稳定车位，并记录标注版本。
3. 跑一次短视频多帧投票，比较单帧与多帧结果差异。
4. 在 `/admin/video` 明确区分“公开数据集训练结果”和“校园样例验证结果”。
5. 用户端只展示余位和风险变化，不声称真实锁位、预约或实时摄像头接入。
