# AI 训练与后端闭环进展

更新时间：2026-04-28

## 当前结论

后端 AI 训练已经不再停留在静态演示数据阶段。目前已经完成：

- ACPDS 公共数据集第一轮轻量 CNN 训练与平台写回验证。
- CNRPark+EXT 大规模 patch 数据接入与 30,000 样本正式训练。
- CNRPark+EXT 训练模型自动推理生成标准 JSON。
- 标准 JSON 写入 `inference_events`，同步更新 `parking_slots`。
- `/parking-lots`、`/admin/video`、`/admin/status` 能通过后端 API 读取写回后的余位与 AI 任务状态。

这说明当前平台已经具备“公开数据集/样例图像 -> 模型推理 -> 标准识别事件 -> 数据库车位状态 -> 前端展示”的最小闭环。

## 已接入训练数据

| 数据集 | 当前状态 | 规模 | 用途 | 许可/来源说明 |
| --- | --- | --- | --- | --- |
| ACPDS | 已下载、已训练、已写回验证 | 本地样例包约 363.2 MB | 第一轮模型训练和 ROI 写回验证 | 按论文/仓库说明记录为 MIT |
| CNRPark+EXT | 已下载、已完成 30,000 样本训练 | patch 包约 428.7 MB | 当前主训练数据，用于 occupied/vacant 二分类 | 官方页面标注 ODbL v1.0 |
| PKLot | 已下载小样本 | 小样本 339.6 KB；全量暂未下载 | 后续跨停车场、天气泛化验证 | Hugging Face 数据卡标注 CC BY 4.0 |
| CARPK | 未下载 | 后续按需 | 车辆检测/计数支线，不作为当前车位占用主训练集 | 学术用途/EULA 约束，需后续核验 |

## CNRPark+EXT 训练结果

训练命令对应能力：

```bash
cd /Users/liguangcheng/Documents/New\ project\ 2/external_repos/primary_ai_parking_system/backend
npm run train:slot-classifier -- --dataset cnrpark_ext --max-samples 30000 --epochs 3
```

训练输出：

- 模型：`SlotOccupancyCNN`
- 训练样本：30,000 个车位 patch
- 验证样本：6,000 个车位 patch
- 测试样本：6,000 个车位 patch
- 训练轮数：3 epoch
- 设备：CPU
- 耗时：约 324 秒
- 模型权重：`ai-services/training_runs/cnrpark_ext_30k_epoch3/cnrpark_ext_slot_cnn_best.pt`

测试集指标：

| 指标 | 数值 |
| --- | ---: |
| accuracy | 0.9718 |
| occupied precision | 0.9897 |
| occupied recall | 0.9587 |
| occupied F1 | 0.9740 |
| vacant precision | 0.9515 |
| vacant recall | 0.9878 |
| vacant F1 | 0.9693 |

混淆矩阵：

|  | 预测空闲 | 预测占用 |
| --- | ---: | ---: |
| 实际空闲 | 2671 | 33 |
| 实际占用 | 136 | 3160 |

## 自动推理写回验证

本轮新增了 CNRPark+EXT 训练模型的 demo 推理配置：

```text
data/demo_ai_inference_config_cnrpark.json
```

执行命令：

```bash
cd /Users/liguangcheng/Documents/New\ project\ 2/external_repos/primary_ai_parking_system/backend
npm run demo:ai-infer:cnr
```

如只检查配置、模型和 ROI 是否就绪，不写数据库：

```bash
npm run demo:ai-infer:cnr -- --dry-run
```

实际写回结果：

- AI 任务 ID：`11`
- AI 任务外部 ID：`65c9df60-6e70-4d1c-b3d5-f4502c0b5414`
- inference event ID：`8`
- 停车场：`ACPDS公开数据集验证停车场`
- ROI 数量：98
- 识别占用：94
- 识别空闲：4
- 平均置信度：0.8844
- 更新车位数：98

这次验证使用 CNRPark+EXT 训练出的模型，对 ACPDS 样例图和 ROI 做跨数据集推理。它证明的是“模型推理结果可以自动进入平台并改变车位状态”，不等同于已经完成北京校园真实场景精度验收。

## 校园样例验证入口

为了向“北京高校试点”更靠近，当前新增了一个合成校园东门样例入口。它使用校园东门停车场的 24 个 ROI 和 CNRPark+EXT 训练模型，验证校园场景数据结构、ROI、推理任务和车位写回链路。该图片由脚本生成，不是真实校园摄像头画面。

生成合成样例图：

```bash
cd /Users/liguangcheng/Documents/New\ project\ 2/external_repos/primary_ai_parking_system
./ai-services/.venv/bin/python ai-services/scripts/generate_synthetic_campus_frame.py
```

检查校园样例配置，不写数据库：

```bash
cd /Users/liguangcheng/Documents/New\ project\ 2/external_repos/primary_ai_parking_system/backend
npm run demo:ai-infer:campus-synthetic -- --dry-run
```

执行校园样例推理写回：

```bash
npm run demo:ai-infer:campus-synthetic
```

当前写回结果：

- AI 任务 ID：`12`
- inference event ID：`9`
- 停车场：`北京高校校园东门试点停车场`
- ROI 数量：24
- 识别占用：24
- 识别空闲：0
- 平均置信度：1.0000
- 更新车位数：24

这一步仍属于“合成非敏感样例验证”，不是正式校园真实摄像头接入，也不作为真实校园场景精度结论。它的价值是证明校园停车场、校园视频源、校园 ROI、模型推理、AI 任务、识别事件和车位状态写回已经能串起来。后续拿到校园授权图片或非敏感视频后，只需要替换 `data/demo_ai_inference_config_campus_synthetic.json` 的 `input_path`，并保持同一套 ROI/写回链路。

## API 验收结果

后端服务启动后，`npm run check:api` 已通过：

- `/api/health` 正常。
- 管理员登录正常。
- `/api/parking/lots` 返回 7 个停车场。
- `/api/parking/status/:lotId` 返回 120 个车位状态。
- `/api/admin/inference-events` 返回最新 AI 事件。
- `/api/admin/ai-processing-jobs` 返回最新 AI 任务。
- `/api/admin/parking-operations` 返回 7 个停车场运维状态和 3 个高占用提示。
- `/api/admin/governance/summary` 返回 4 个区域治理汇总。

## 当前局限

- 当前模型训练数据来自公开数据集，不代表北京高校真实停车场。
- CNRPark+EXT 模型已具备较好 patch 分类指标，但仍需要用校园自采非敏感图片/视频做本地化验证。
- ACPDS 与 CNRPark+EXT 的摄像机视角、天气、画质、车位形态不同，跨数据集推理结果只能作为工程闭环证明。
- 当前没有接入真实摄像头网络，没有车牌识别、支付、预约或车位锁定能力。
- 线上部署时不应上传大型原始数据集和训练权重；云端只展示训练结果和演示写回事件。

## 下一步建议

1. 采集或制作一段校园非敏感样例视频，补 20-30 个清晰 ROI。
2. 用当前 `demo:ai-infer` 链路跑校园样例，形成“校园试点”第二份验证记录。
3. 在管理端 `/admin/video` 中把“公开数据集验证”和“校园样例验证”分开展示。
4. 继续训练更强的模型前，先完善标注质量、ROI 覆盖率和失败样例分析。
5. 若要提升比赛可信度，优先补充模型误判截图、混淆矩阵解释和数据许可引用。
