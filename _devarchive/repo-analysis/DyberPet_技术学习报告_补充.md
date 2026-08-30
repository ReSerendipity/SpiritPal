# DyberPet 补充分析报告（覆盖原报告未涉及模块）

> **注：本报告为 `DyberPet_Repo_Analysis.md` 的补充，不重复已覆盖的 HP 概率矩阵 / Buff / 任务 / 物品 schema 主体内容。**

> 分析日期：2026-07-14
> 分析分支：main（开源代码 v0.6.7）
> 报告定位：对原报告未深入的对话系统、收藏系统、商店 UI、气泡配置、物品 schema 细节进行补全，并与 SpiritPal 现状逐项对比。

---

## 目录

1. [补充分析范围说明](#1-补充分析范围说明)
2. [对话系统分析](#2-对话系统分析)
3. [收藏系统分析](#3-收藏系统分析)
4. [商店 UI 分析](#4-商店-ui-分析)
5. [气泡配置分析](#5-气泡配置分析)
6. [物品 Schema 更新](#6-物品-schema-更新)
7. [与 SpiritPal 的对比及建议](#7-与-spiritpal-的对比及建议)

---

## 1. 补充分析范围说明

### 1.1 原报告已覆盖内容（不在本报告重复）

原报告 `DyberPet_Repo_Analysis.md` 已系统覆盖以下模块：

- HP 饱食度 4 级阈值与动画概率矩阵（`settings.py` 中 `HP_TIERS` / `TIER_NAMES`）
- FV 好感度等级体系（`LVL_BAR` 200/256 级、星月太阳皇冠徽章）
- 金币系统常量（`PP_COIN` / `COIN_MU` / `COIN_SIGMA` / `ITEM_DEPRECIATION`）
- 任务系统（番茄钟、专注时间、6 种通知类型）
- Buff 系统概览与 `buffModule.py`
- 物品系统基础（6 种 ITEM_BGC 分类、`fv_reward`、自动喂食）
- 商店系统一句话概述（v0.3.4 实装、按字符搜索、卖出贬值 25%）
- 通知与对话气泡系统一句话概述（9 种气泡、`feed_required` ×5、频繁点击触发）
- 模组系统、动画渲染、AI 集成、构建打包等

### 1.2 本补充报告覆盖内容

本报告针对原报告未深入的 5 个模块进行 **代码级** 分析，所有结论附带 `文件:行号` 引用：

| 模块 | 关键文件 | 分析深度 |
|------|----------|----------|
| 对话系统 | `custom_widgets.py:77-318`、`Accessory.py:127-138`、`conf.py:194-204`、`DyberPet.py:1509-1515` | 对话树结构、条件评估、UI 渲染、Back 回溯逻辑 |
| 收藏系统 | `inventoryUI.py:55-111`、`dashboard_widgets.py:1809-1879`、`extra_windows.py:2389-2407` | 类型边界、Tab 归属、`clct_inuse` 切换、掉落与奖励 |
| 商店 UI | `shopUI.py:27-318`、`dashboard_widgets.py:727-784/1495-1904/2048-2090` | 卡片布局、锁定状态、买卖流程、货币组件 |
| 气泡配置 | `bubble_conf.json`、`bubbleManager.py:51-205` | 8+1 类型、`countdown` 字段、HP 分级候选、`USERTAG`/`ITEMNAME` 占位 |
| 物品 Schema | `docs/art_dev.md:498-623`、`items_config.json` | 4 真实类型（非 6）、`cost` 默认值、`pet_limit`、5 种 Buff effect |

---

## 2. 对话系统分析

### 2.1 系统定位

DyberPet 的对话系统并非独立的 NPC 对话框架，而是 **「对话类物品」触发的多分支文字对话框**。其本质是：用户在背包中使用 `type == 'dialogue'` 的物品后，弹出一个可拖拽、带选项分支的对话框 UI，实现文字游戏中「选择不同选项进入不同分支」的体验。

完整开发文档位于 `docs/art_dev.md:617-723`，配置文件为 `res/role/{角色名}/msg_conf.json`。

### 2.2 数据结构与配置加载

#### msg_conf.json 结构（`docs/art_dev.md:648-672`）

```json
{
    "对话1": {
        "title": "晚安",
        "start": "text_1",
        "text_1": "晚安。",
        "text_2": "睡觉之前，要不要再去上一次厕所呢？",
        "option_1": "晚安，纳西妲。",
        "option_2": "（继续）",
        "relationship": {
            "text_1": ["option_1"],
            "text_2": ["option_2"],
            "option_1": ["text_2"],
            "option_2": ["text_3"]
        }
    }
}
```

对话节点由两类 Key 构成：
- `text_编号`：对话文字节点
- `option_编号`：选项节点

`relationship` 字段定义了一个 **有向图**，边分为两种：
- `"text_N": ["option_A", "option_B"]`：文字节点展示时，出现哪些选项
- `"option_N": ["text_M"]`：点击该选项后，切换到哪个文字节点（列表仅允许 1 个元素）

#### 物品与对话的绑定（`docs/art_dev.md:705-723`）

对话物品与对话内容的映射在 `pet_conf.json` 的 `msg_dict` 字段中：

```json
{
    "msg_dict": {
        "纳西妲的信": "对话1",
        "纳西妲的对话2": "对话2"
    }
}
```

#### 配置加载流程（`conf.py:194-204`）

```python
msg_file = os.path.join(basedir, 'res/role/{}/msg_conf.json'.format(pet_name))
if os.path.isfile(msg_file):
    msg_data = dict(json.load(open(msg_file, 'r', encoding='UTF-8')))
    msg_dict = conf_params.get("msg_dict", {})
    for msg in msg_dict.keys():
        msg_dict[msg] = msg_data[msg_dict[msg]]   # 物品名 -> 完整对话 dict
    o.msg_dict = msg_dict
else:
    o.msg_dict = {}
```

注意：`msg_dict` 的 Key 是物品名，Value 在加载后被 **原地替换** 为完整的对话内容 dict（包含 `title`/`start`/`text_*`/`option_*`/`relationship`），运行时不再查表。

### 2.3 触发与调度链路

#### 使用物品入口（`DyberPet.py:1509-1515`）

```python
elif settings.items_data.item_dict[item_name]['item_type']=='dialogue':
    if item_name in self.pet_conf.msg_dict:
        accs = {'name':'dialogue', 'msg_dict':self.pet_conf.msg_dict[item_name]}
        x = self.pos().x()
        y = self.pos().y()
        self.setup_acc.emit(accs, x, y)
        return
```

对话物品被当作 **「附件（Accessory）」** 处理，通过 `setup_acc` 信号派发。

#### 附件调度（`Accessory.py:127-138`）

```python
elif acc_act.get('name','') == 'dialogue':
    # 对话框不可重复打开
    for qacc in self.acc_dict:
        try:
            msg_title = self.acc_dict[qacc].message['title']
        except:
            continue
        if msg_title == acc_act['msg_dict']['title']:
            return   # 同标题对话框已打开，直接拒绝
    self.acc_dict[acc_index] = DPDialogue(acc_index, acc_act['msg_dict'],
                                          pos_x, pos_y)
```

关键设计：**以 `title` 为去重键**，同一标题的对话框同一时间只允许存在一个实例，避免重复弹窗。

### 2.4 DPDialogue 对话框 UI（`custom_widgets.py:77-318`）

#### 整体结构（`custom_widgets.py:98-204`）

- 圆角白底 QFrame（`__initWidget` 第 101-111 行）
- 顶部 Header：图标 + `title`（StrongBodyLabel）+ 关闭按钮（`TransparentToolButton(FIF.CLOSE)`）
- 中部 Context：`BodyLabel` 显示当前文字，固定宽度 250px，自动换行
- 底部 Options：`OptionLayout`（QVBoxLayout）动态生成选项按钮
- 窗口Flags：`Qt.FramelessWindowHint | Qt.SubWindow | Qt.WindowStaysOnTopHint | Qt.NoDropShadowWindowHint`（Windows，第 196 行）
- 初始位置：`move(pos_x - width//2, pos_y - height)`，即以宠物坐标为底部中心
- 支持 **鼠标拖拽**（`mousePressEvent`/`mouseMoveEvent`/`mouseReleaseEvent`，第 206-236 行）

#### 选项生成 OptionGenerator（`custom_widgets.py:257-287`）

```python
def OptionGenerator(self, text_key=None, prev_text=None, reverse=False):
    # 清空旧选项
    for item in [self.OptionLayout.itemAt(i) for i in range(self.OptionLayout.count())]:
        widget = item.widget()
        self.OptionLayout.removeWidget(widget)
        widget.deleteLater()

    self.opts_dict = {}
    option_index = 0

    # Back 回溯按钮注入
    if prev_text is not None and not reverse:
        if text_key is not None:
            self.message['relationship']['option_prev_%s'%text_key] = [prev_text]
            if 'option_prev_%s'%text_key not in self.message['relationship'].get(text_key, []):
                self.message['option_prev_%s'%text_key] = self.tr('Back')
                self.message['relationship'][text_key] = self.message['relationship'].get(text_key, []) + ['option_prev_%s'%text_key]
        else:
            # 叶子节点（无后续选项）注入 Back
            self.message['relationship']['option_prev_end'] = [prev_text]
            self.opts_dict[option_index] = DialogueButtom(self.tr('Back'), 'option_prev_end')
            self.opts_dict[option_index].clicked.connect(self.confirm)
            self.OptionLayout.addWidget(self.opts_dict[option_index], Qt.AlignCenter)

    # 正常选项
    if text_key is not None:
        for option in self.message.get('relationship', {}).get(text_key, []):
            self.opts_dict[option_index] = DialogueButtom(self.message[option], option)
            self.opts_dict[option_index].clicked.connect(self.confirm)
            self.OptionLayout.addWidget(self.opts_dict[option_index], Qt.AlignCenter)
            option_index += 1
```

#### 选项确认 confirm（`custom_widgets.py:290-303`）

```python
def confirm(self):
    opt_key = self.sender().msg_key
    new_key = self.message['relationship'].get(opt_key, [])
    if new_key == []:
        # 选项无后继：清空文字，生成 Back 按钮
        self.label.setText('')
        self.label.adjustSize()
        self.OptionGenerator(prev_text=self.text_now, reverse=self.sender().msg==self.tr('Back'))
        self.text_now = ''
    else:
        new_key = new_key[0]
        self.label.setText(self.message[new_key])
        self.label.adjustSize()
        self.OptionGenerator(new_key, self.text_now, reverse=self.sender().msg==self.tr('Back'))
        self.text_now = new_key
    self.frame.adjustSize()
    self.adjustSize()
```

### 2.5 对话树结构总结

| 维度 | 实现 |
|------|------|
| **图模型** | 有向图，节点 = `text_*` / `option_*`，边 = `relationship` 字典 |
| **分支机制** | 纯用户选择驱动，**无状态条件评估**（不检查 HP/FV/金币/任务等） |
| **回溯（Back）** | 运行时动态注入 `option_prev_{text_key}` 节点到 `relationship`，实现「返回上一句」 |
| **终止条件** | 选项的 `relationship` 值为空列表 `[]` 时，到达叶子节点，仅生成 Back |
| **防重复** | 以 `title` 为键，同标题对话框不可重复打开（`Accessory.py:128-135`） |
| **死循环风险** | 文档明确警告「别把对话做成了死循环」（`art_dev.md:698`），由模组作者负责 |

### 2.6 关键限制

1. **无条件分支**：`relationship` 只能基于用户选择跳转，无法根据宠物状态（如好感度等级、是否拥有某物品）走不同分支。所有分支都是「显式选项」。
2. **无变量系统**：不支持设置/读取对话内变量（如好感度增减、物品消耗），对话纯展示。
3. **Back 逻辑侵入式**：`option_prev_*` 节点被直接写入 `self.message['relationship']`，会污染原始配置（多次往返可能累积），属于「能用但不优雅」的实现。
4. **单线程 UI**：对话框是模态独立的 QWidget，关闭后通过 `closed_acc` 信号通知 `DPAccessory` 清理（`custom_widgets.py:241-244`）。

---

## 3. 收藏系统分析

### 3.1 类型边界澄清

原报告称「6 种物品类型」，这是将 `settings.py:78-83` 的 `ITEM_BGC` UI 背景色字典与物品真实类型混淆。**物品真实类型只有 4 种**（`docs/art_dev.md:558-563`、`conf.py:1360-1368`）：

| 真实 type 值 | 含义 | ITEM_BGC 中的对应 |
|--------------|------|-------------------|
| `consumable` | 消耗品 | `consumable` |
| `collection` | 收藏品 | `collection` |
| `dialogue` | 对话物品（本质是收藏品子类） | `dialogue` |
| `subpet` | 迷你宠物 | `subpet` |
| ——（UI 占位） | 空格子 | `Empty` |
| ——（UI 占位） | 自动喂食格 | `autofeed` |

`Empty` 和 `autofeed` 不是物品类型，而是背包 UI 中空格与自动喂食格的背景色分类。`dialogue` 在数据层是独立 type，但在 UI 层与 `collection` 共用同一 Tab（见 3.3）。

### 3.2 收藏品的定义与约束

根据 `docs/art_dev.md:566-571`，收藏品的设计约束：

| 类型 | 注意事项 |
|------|----------|
| `collection` | 点击使用时不触发任何效果；无需填写 `effect_HP`/`effect_FV`；建议不要填写 `drop_rate`/`buff` |
| `dialogue` | 不应有任何效果，请勿填写 `effect_HP`/`effect_FV`/`buff` |
| `subpet` | 仅用于召唤迷你宠物，请勿填写 `effect_HP`/`effect_FV`/`drop_rate`，强烈建议设计 Buff |

收藏品的核心用途是 **作为好感度升级奖励**（`fv_reward` 字段，`art_dev.md:553`），即升至指定等级时自动赠送给用户，用于「奖章、角色周边」等纪念物。

### 3.3 背包中的收藏品展示

#### Tab 归属（`inventoryUI.py:55`、`inventoryUI.py:110-112`）

```python
self.tab_dict = {'consumable':0, 'collection':1, 'dialogue':1, 'subpet':2}
...
self.foodInterface = itemTabWidget(self.items_data, ['consumable'], sizeHintdb, 0)
self.clctInterface = itemTabWidget(self.items_data, ['collection','dialogue'], sizeHintdb, 1)
self.petsInterface = itemTabWidget(self.items_data, ['subpet'], sizeHintdb, 2)
```

`collection` 和 `dialogue` 共享第 2 个 Tab（「收藏」），`subpet` 单独第 3 个 Tab（「宠物」）。

#### 视觉样式区分（`dashboard_widgets.py:1809-1810`、`1851`、`1865`）

```python
if self.item_config.get('item_type', 'consumable') in ['collection', 'dialogue']:
    self.setStyleSheet(CollectStyle)
else:
    self.setStyleSheet(ItemStyle)
```

收藏品/对话品使用 `CollectStyle`（不同边框样式），与消耗品 `ItemStyle` 视觉区分。

### 3.4 收藏品的使用行为：切换而非消耗

#### consumeItem 逻辑（`dashboard_widgets.py:1875-1879`）

```python
def consumeItem(self):
    if self.item_config.get('item_type', 'consumable') in ['collection', 'dialogue']:
        self.clct_inuse = not self.clct_inuse   # 切换「使用中」状态
    else:
        self.item_num += -1                      # 消耗品才扣减数量
```

收藏品/对话品 **不会扣减数量**，而是切换 `clct_inuse` 布尔状态。这对应「装备/卸下」语义，而非「消耗」。

#### 背包使用分支（`extra_windows.py:2389-2407`）

```python
elif self.items_data.item_dict[item_name_selected]['item_type'] == 'collection':
    self.cells_dict[self.selected_cell].unselected()
    self.cells_dict[self.selected_cell].consumeItem()
    if self.cells_dict[self.selected_cell].clct_inuse:
        self.use_item_inven.emit(item_name_selected)   # 装备
    else:
        self.use_item_inven.emit(item_name_selected)   # 卸下（同一信号）
    self.selected_cell = None
    self.changeButton()

elif self.items_data.item_dict[item_name_selected]['item_type'] == 'dialogue':
    self.cells_dict[self.selected_cell].unselected()
    self.use_item_inven.emit(item_name_selected)        # 直接触发对话
    self.selected_cell = None
    self.changeButton()
```

注意：`collection` 与 `dialogue` 在背包层的处理不同——`collection` 走 `consumeItem` 切换 `clct_inuse`，`dialogue` 不切换状态而直接 emit 信号触发对话框（接 §2.3 链路）。

### 3.5 收藏品的掉落与奖励

#### 掉落（`inventoryUI.py:341-343`）

```python
if self.items_data.item_dict[item]['item_type'] == 'collection':
    self.add_item(item, 1)
    self.calculate_droprate()
```

收藏品可作为点击宠物时的随机掉落物，但每次仅掉落 1 个（数量恒为 1，与其「唯一性」语义一致）。

#### 奖励（`docs/art_dev.md:553`）

`fv_reward` 字段为 List，如 `[1, 2]` 表示升至 1 级和 2 级时都会奖励该物品。文档建议收藏品作为升级奖励。

### 3.6 商店中的收藏品

`shopUI.py:38` 与 `dashboard_widgets.py:1784-1787` 中，`collection` 和 `dialogue` 都被映射到商店筛选的「Collection」分类：

```python
self.tab_dict = {'consumable':0, 'collection':1, 'dialogue':1, 'subpet':2}
self.conf2uiMap = {'consumable':self.tr('Food'),
                   'collection':self.tr('Collection'),
                   'dialogue':self.tr('Collection'),
                   'subpet':self.tr('Pet')}
```

且非消耗品在商店中 **每人只允许拥有 1 个**（`shopUI.py:285`），与收藏品唯一性语义一致。

---

## 4. 商店 UI 分析

### 4.1 整体架构

商店 UI 由三个文件协作：

| 文件 | 类 | 职责 |
|------|----|------|
| `shopUI.py:27-318` | `shopInterface(ScrollArea)` | 商店主容器，信号中枢 |
| `dashboard_widgets.py:1768-1904` | `ShopView(QWidget)` | 商品卡片流式布局 |
| `dashboard_widgets.py:1495-1714` | `ShopItemWidget(SimpleCardWidget)` | 单个商品卡片 |
| `dashboard_widgets.py:2048-2090` | `ShopMessageBox(MessageBoxBase)` | 买卖数量选择弹窗 |
| `dashboard_widgets.py:727-784` | `coinWidget(QWidget)` | 金币显示组件 |
| `dashboard_widgets.py:1910+` | `filterView(SimpleCardWidget)` | 筛选面板 |

### 4.2 shopInterface 主容器（`shopUI.py:27-318`）

#### 信号定义（`shopUI.py:29-31`）

```python
buyItem = Signal(str, int, name='buyItem')
sellItem = Signal(str, int, name='sellItem')
updateCoin = Signal(int, bool, bool, name='updateCoin')
```

`updateCoin` 的三个参数：`delta`、`show_anim`（是否播放金币动画）、`record_history`（是否记入历史）。

#### 布局结构（`shopUI.py:48-94`）

- **Header**（`headerWidget`，第 49-71 行）：`Shop` 标题 + 帮助按钮 + `coinWidget`（右上角金币数）
- **Header2**（`header2Widget`，第 74-89 行）：搜索框（`SearchLineEdit`，250px 宽）+ 筛选按钮（`Filter`，100px 宽）
- **ShopView**（第 91 行）：商品卡片区域
- 滚动区域上边距 130px（为两个 Header 留空间），筛选展开时 +`filterView.height()+10`（`shopUI.py:174`）

#### 筛选与搜索（`shopUI.py:96-120`、`180-197`）

```python
def _init_filter(self):
    self.filterView = filterView(self)
    self.filterView.addFilter(title=self.tr('Type'),
                                options=[self.tr('Food'),self.tr('Collection'),self.tr('Pet')])
    mods = get_MODs(os.path.join(basedir,'res/items'))
    self.filterView.addFilter(title=self.tr('MOD'), options=mods)
    self.filterView.filterChanged.connect(self._updateList_filter)
```

筛选维度仅两个：**Type**（Food/Collection/Pet）和 **MOD**（物品模组来源）。搜索为前缀匹配（见 4.3）。

### 4.3 ShopView 商品列表（`dashboard_widgets.py:1768-1904`）

#### 初始化与排序（`dashboard_widgets.py:1800-1811`）

```python
def _init_items(self):
    keys = self.items_data.keys()
    keys = [i for i in keys if self.items_data[i]['cost'] != -1]   # 排除不可售物品
    keys_lvl = [self.items_data[i]['fv_lock'] for i in keys]
    keys = [x for _, x in sorted(zip(keys_lvl, keys))]             # 按 fv_lock 升序
```

关键：`cost == -1` 的物品（如金币本身）不会出现在商店；商品按 `fv_lock` 升序排列（低等级解锁的排前面）。

#### 搜索索引（`dashboard_widgets.py:1830-1833`）

```python
def _addToDict(self, item_idx, itemName):
    for i in range(len(itemName)):
        self.searchDict[itemName[0:i+1]].append(item_idx)
```

搜索索引为 **所有前缀** 倒排表，支持任意前缀匹配（如「薯」匹配「薯条」）。

#### 过滤合并（`dashboard_widgets.py:1861-1886`）

`_updateList` 先取搜索结果，再与各筛选 Tag 取交集，最后 `card.setVisible(isVisible)` 控制显隐（不销毁卡片）。

#### 好感度解锁刷新（`dashboard_widgets.py:1900-1903`）

```python
def _fvchange(self, fv_lvl):
    for idx, card in self.cards.items():
        if fv_lvl >= card.fv_lock and not card.unlocked and card.locked_reason == 'FVLOCK':
            card._update_UI()
```

好感度升级时，遍历所有卡片，解锁满足条件的商品（仅处理 `FVLOCK`，不处理 `PETLIMIT`）。

### 4.4 ShopItemWidget 商品卡片（`dashboard_widgets.py:1495-1714`）

#### 锁定状态判定（`dashboard_widgets.py:1553-1568`）

```python
def _getLockStat(self):
    unlocked = settings.pet_data.fv_lvl >= self.fv_lock and settings.petname in self.pet_limit
    if settings.petname not in self.pet_limit:
        self.locked_reason = 'PETLIMIT'
    elif settings.pet_data.fv_lvl < self.fv_lock:
        self.locked_reason = 'FVLOCK'
    else:
        self.locked_reason = 'NONE'
    ...
```

锁定有两种原因：
- `FVLOCK`：好感度不足，显示 `Favor Req: {fv_lock}`（红色 `#ff333d`）
- `PETLIMIT`：角色受限，显示 `Other Chars Only`（灰色 `#636363`）

#### 锁定视觉处理（`dashboard_widgets.py:1603-1617`）

```python
if not self.unlocked:
    pixmap = Silhouette(pixmap)       # 灰色剪影
...
if not self.unlocked:
    title = MaskPhrase(self.item_name)  # 名称遮罩
```

`Silhouette`（`dashboard_widgets.py:2094-2110`）通过 `QPainter.CompositionMode_SourceIn` 将图标填充为灰色 `#787878`；`MaskPhrase` 对名称做遮罩处理。锁定时买入/卖出按钮均禁用（第 1671-1673 行）。

#### 卡片布局（`dashboard_widgets.py:1595-1685`）

固定尺寸 `SHOPITEM_W × SHOPITEM_H`，纵向三段：
1. **描述区**：图标（`SHOPITEM_WH × SHOPITEM_WH`，固定方形）+ 名称（DemiBold 14pt）+ 信息行（Normal 14pt）
2. **按钮区**：买入按钮（显示价格 + 金币图标，85px 宽）+ 卖出按钮（`Sell`，85px 宽）

背景色按 `ITEM_BGC[item_type]` 区分（`_setQss` 第 1688-1700 行）。

### 4.5 买卖流程

#### 买入 _buyItem（`shopUI.py:281-312`）

```python
def _buyItem(self, item_name):
    item_conf = self.items_data.item_dict[item_name]
    # 非消耗品仅允许拥有 1 个
    if item_conf['item_type'] != 'consumable' and settings.pet_data.items.get(item_name, (None,0))[1] > 0:
        content = self.tr('One Char can have only one ') + f"[{item_name}]"
        self.__showSystemNote(content, 1)
        return
    # 最大可买数量
    cost = item_conf['cost']
    if item_conf['item_type'] == 'consumable':
        maxNum = settings.pet_data.coins // cost
    else:
        maxNum = 1
    # 弹窗选择数量
    w = ShopMessageBox(option='buy', item_name=item_name, maxNum=maxNum, cost=cost, parent=self)
    w.bill.connect(self._getNum)
    if w.exec():
        pass
    else:
        return
    if self.NumItemInDeal > 0:
        self.buyItem.emit(item_name, self.NumItemInDeal)
        self.updateCoin.emit(-cost * self.NumItemInDeal, True, False)
    self.NumItemInDeal = 0
```

#### 卖出 _sellItem（`shopUI.py:253-279`）

```python
def _sellItem(self, item_name):
    item_conf = self.items_data.item_dict[item_name]
    if settings.pet_data.items.get(item_name, (None,0))[1] <= 0:
        return
    cost = int(item_conf['cost'] * settings.ITEM_DEPRECIATION)   # 贬值 25%
    maxNum = settings.pet_data.items.get(item_name, (None,0))[1]
    w = ShopMessageBox(option='sell', item_name=item_name, maxNum=maxNum, cost=cost, parent=self)
    w.bill.connect(self._getNum)
    if w.exec():
        pass
    else:
        return
    if self.NumItemInDeal > 0:
        self.sellItem.emit(item_name, -self.NumItemInDeal)              # 负数表示扣减
        self.updateCoin.emit(cost * self.NumItemInDeal, True, False)
    self.NumItemInDeal = 0
```

关键：卖出价 = `int(cost * 0.75)`（`ITEM_DEPRECIATION = 0.75`，`settings.py:58`），即 **贬值 25%**。

#### 数量选择弹窗 ShopMessageBox（`dashboard_widgets.py:2048-2090`）

```python
class ShopMessageBox(MessageBoxBase):
    bill = Signal(int, name='bill')
    def __init__(self, option, item_name, maxNum, cost, parent=None):
        ...
        self.numSpinBox = SpinBox(self)
        self.numSpinBox.setMinimum(0)
        self.numSpinBox.setMaximum(maxNum)
        self.yesButton.setIcon(settings.items_data.coin['image'])
        self.yesButton.setText('0')
        self.numSpinBox.textChanged.connect(self._updateCost)

    def _updateCost(self, num):
        self.itemNum = int(num)
        self.bill.emit(self.itemNum)
        if self.option == 'buy':
            self.yesButton.setText(f'-{self.cost * self.itemNum}')   # 买入显示负数
        elif self.option == 'sell':
            self.yesButton.setText(f'+{self.cost * self.itemNum}')   # 卖出显示正数
```

确认按钮实时显示金币变化（买入 `-N`，卖出 `+N`），直观反馈。

### 4.6 货币系统与 coinWidget（`dashboard_widgets.py:727-784`）

```python
class coinWidget(QWidget):
    def _init_widget(self):
        self.icon.setPixmap(settings.items_data.coin['image'])
        self.icon.setToolTip(settings.items_data.coin['name'].get(
            settings.language_code, settings.items_data.coin['name']['default']))
        self.coinAmount = LineEdit(self)
        self.coinAmount.setEnabled(False)
        ...
    def _updateCoin(self, coinNumber: int):
        num_str = f"{coinNumber:,}"                          # 千分位格式化
        self.coinAmount.setText(num_str)
        self.coinAmount.setFixedWidth(len(num_str)*7 + 29)   # 动态宽度
```

金币图标与名称支持 **按角色自定义**（`pet_conf.json` 的 `coin_config`，`docs/art_dev.md:180-188`），如纳西妲用「摩拉」。`coinWidget` 在商店 Header 和背包 Header 共享实例，金币变化自动同步。

---

## 5. 气泡配置分析

### 5.1 配置文件结构

#### 系统默认配置（`res/icons/bubble_conf.json`）

```json
{
    "fv_lvlup":     {"icon": "bb_fv_lvlup",   "message": "", "countdown": null,  "start_audio": null, "end_audio": null},
    "fv_drop":      {"icon": "bb_fv_drop",    "message": "", "countdown": null,  "start_audio": null, "end_audio": null},
    "hp_low":       {"icon": "bb_hp_low",     "message": "", "countdown": null,  "start_audio": null, "end_audio": null},
    "hp_zero":      {"icon": "bb_hp_zero",    "message": "", "countdown": null,  "start_audio": null, "end_audio": null},
    "feed_done":    {"icon": "bb_feed_done",  "message": "", "countdown": null,  "start_audio": null, "end_audio": null},
    "feed_required":{"icon": null, "message": "USERTAG I want to have ITEMNAME", "countdown": 120, "start_audio": null, "end_audio": null},
    "pat_focus":    {"icon": "bb_pat_focus",  "message": "USERTAG You should be focusing on your work", "countdown": null, "start_audio": null, "end_audio": null},
    "pat_frequent": {"icon": "bb_pat_frequent","message": "", "countdown": null, "start_audio": null, "end_audio": null}
}
```

#### 字段含义（`bubbleManager.py:35-46`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `icon` | str/null | 指向 `note_icon.json` 中的通知类型 Key（不是文件路径） |
| `message` | str | 气泡文字，支持 `USERTAG`/`ITEMNAME` 占位符 |
| `countdown` | int/null | 倒计时秒数，非空时气泡上显示倒计时（仅 `feed_required` 用 120s） |
| `start_audio` | str/null | 气泡出现时播放的语音（指向 `note_icon.json`） |
| `end_audio` | str/null | 气泡消失时播放的语音 |

#### 9 种气泡类型（`docs/art_dev.md:354-364`、`bubbleManager.py:10-31`）

| 类型 | 触发条件 | 默认图标 | 默认文字 |
|------|----------|----------|----------|
| `fv_lvlup` | 好感度升级 | blushing.svg | 无 |
| `fv_drop` | 好感度开始下降（饱食度为 0） | crying.svg | 无 |
| `hp_low` | 饱食度 < 80 随机出现 | delicious.svg | 无 |
| `hp_zero` | 饱食度为 0 随机出现 | angel.svg | 无 |
| `feed_done` | 喂食后 | blushing.svg | 无 |
| `feed_required` | 随机索要食物 | 对应物品图标 | `USERTAG I want to have ITEMNAME` |
| `pat_focus` | 专注时间点击宠物 | neutral.svg | `USERTAG You should be focusing on your work` |
| `pat_frequent` | 1s 内点击 ≥7 次 | confused.svg | 无 |
| `pat_random_{N}` | 点击宠物 40% 概率触发 | 无 | 无（可自定义不限数量） |

注意：默认配置文件中只有 8 种，第 9 种 `pat_random_{N}` 是 **动态扩展类型**，由模组作者按 `pat_random_1`/`pat_random_2`/... 自行添加（`bubbleManager.py:31` 注释）。

### 5.2 BubbleManager 类（`bubbleManager.py:51-205`）

#### 配置加载与合并（`bubbleManager.py:70-88`）

```python
def load_bubble_config(self) -> dict:
    system_conf_file = os.path.join(basedir, 'res/icons/bubble_conf.json')
    pet_bb_conf_file = os.path.join(basedir, f'res/role/{settings.petname}/note/bubble_conf.json')
    bubble_conf = dict(json.load(open(system_conf_file, 'r', encoding='UTF-8')))
    if os.path.exists(pet_bb_conf_file):
        pet_bb_conf = dict(json.load(open(pet_bb_conf_file, 'r', encoding='UTF-8')))
        # 默认类型配置更新
        for k in bubble_conf.keys():
            if k in pet_bb_conf.keys():
                bubble_conf[k].update(pet_bb_conf[k])
        # 新增类型
        for k in pet_bb_conf.keys():
            if k not in bubble_conf.keys():
                bubble_conf[k] = self._format_bubble_type_conf(pet_bb_conf[k])
    return bubble_conf
```

合并策略：系统配置为基底，角色配置 **字段级 update**（非整体替换），新增类型走 `_format_bubble_type_conf` 规整字段（缺省补 `None`，`bubbleManager.py:90-95`）。

#### HP 分级候选气泡（`bubbleManager.py:60-62`）

```python
bubble_hp_tier = {0: ["fv_drop", "hp_zero", "feed_required"],
                  1: ["hp_low", "feed_required"],
                  2: ["hp_low", "feed_required"]}
```

注意：仅 tier 0/1/2 有候选，tier 3（活力 hp>80）**无候选气泡**——活力状态不触发定时随机气泡。

#### 定时触发（`bubbleManager.py:122-128`）

```python
def trigger_scheduled(self):
    cand_bubbles = self.bubble_hp_tier.get(settings.pet_data.hp_tier, [])
    if not cand_bubbles:
        return
    bb_type = random.choice(cand_bubbles)
    self.trigger_bubble(bb_type)
```

定时器随机从当前 HP 分级对应的候选列表中等概率选择一个触发。

#### 主触发 trigger_bubble（`bubbleManager.py:97-120`）

```python
def trigger_bubble(self, bb_type):
    bubble_dict = self.bubble_conf.get(bb_type, {}).copy()
    if not bubble_dict:
        return
    if bb_type == "feed_required":
        bubble_dict = self.prepare_feed_required()
        if not bubble_dict:
            return
    # pat_random_1 -> pat_random
    bb_type = "_".join(bb_type.split("_")[:2])
    bubble_dict['bubble_type'] = bb_type
    message = bubble_dict.get('message', '')
    message = self.tr(message)
    message = self._replace_usertag(message)
    bubble_dict['message'] = message
    if settings.bubble_on:
        self.register_bubble.emit(bubble_dict)
```

关键点：
1. `feed_required` 走专门的 `prepare_feed_required`（见 5.3）
2. `bb_type` 归一化：`pat_random_1` → `pat_random`（保留前两段），便于 UI 层统一处理
3. `USERTAG` 占位符替换在触发时进行（非渲染时）
4. 全局开关 `settings.bubble_on` 控制是否真正 emit

#### pat_random 触发（`bubbleManager.py:130-134`）

```python
def trigger_patpat_random(self):
    candidates = [k for k in self.bubble_conf.keys() if k.startswith("pat_random_")]
    if candidates:
        bb_type = random.choice(candidates)
        self.trigger_bubble(bb_type)
```

从所有 `pat_random_*` Key 中等概率随机选择一个。

### 5.3 feed_required 的特殊处理（`bubbleManager.py:136-165`）

```python
def prepare_feed_required(self):
    # HP 和 FV 都满则不触发
    hp_full = settings.pet_data.hp >= ((settings.HP_TIERS[-1]-1)*settings.HP_INTERVAL)
    fv_full = (settings.pet_data.fv_lvl == (len(settings.LVL_BAR)-1)) and (settings.pet_data.fv==settings.LVL_BAR[settings.pet_data.fv_lvl])
    if hp_full and fv_full:
        return {}
    bubble_dict = self.bubble_conf['feed_required'].copy()
    # 候选物品：消耗品
    all_items = settings.items_data.item_dict.keys()
    candidate_items = [i for i in all_items if settings.items_data.item_dict[i]['item_type'] == 'consumable']
    # 排除讨厌的物品
    dislike_items = set(settings.pet_conf.item_dislike.keys())
    candidate_items = [i for i in candidate_items if i not in dislike_items and i != 'coin']
    # 排除负效果物品
    candidate_items = [i for i in candidate_items if settings.items_data.item_dict[i]['effect_HP'] > 0 or settings.items_data.item_dict[i]['effect_FV'] > 0]
    if not candidate_items:
        return {}
    selected_item = random.choice(candidate_items)
    bubble_dict['icon'] = selected_item
    bubble_dict['item'] = selected_item
    bubble_dict['message'] = self.tr(bubble_dict['message'])
    bubble_dict['message'] = bubble_dict['message'].replace("ITEMNAME", f"[{selected_item}]")
    return bubble_dict
```

筛选逻辑：
1. HP 和 FV 都满 → 不触发
2. 候选 = 消耗品 ∩ 非讨厌物品 ∩ 非金币 ∩ (effect_HP>0 或 effect_FV>0)
3. 等概率随机选一个，将 `ITEMNAME` 替换为 `[物品名]`，`icon` 设为该物品

喂食 `feed_required` 指定物品时，HP/FV 效果 ×5（`FACTOR_FEED_REQ = 5`，`settings.py:65`，原报告已覆盖）。

### 5.4 USERTAG 占位符系统（`bubbleManager.py:184-193`）

```python
def _replace_usertag(self, message):
    usertag = settings.usertag_dict.get(settings.petname, "")
    if usertag:
        message = message.replace('USERTAG', usertag)
    else:
        message = message.replace('USERTAG', usertag)   # 空字符串
    message = message.strip(' ')
    message = re.sub(r'\s{2,}', ' ', message)   # 压缩连续空格
    return message
```

`usertag_dict` 按角色名索引昵称（v0.6.2 用户昵称系统），未设置时替换为空字符串并压缩多余空格。`add_usertag` 方法（第 167-182 行）支持在气泡文字前/后动态追加 `USERTAG`。

---

## 6. 物品 Schema 更新

本节补充原报告未涉及的 `docs/art_dev.md` 中物品 schema 详细字段，并修正原报告的「6 种类型」说法。

### 6.1 真实物品类型（4 种，非 6 种）

原报告 4.1 节称「6 种物品类型」，实际 `docs/art_dev.md:558-563` 与 `conf.py:1360` 明确只有 **4 种 type**：

```json
"type": "consumable"  // 可选值：consumable | dialogue | collection | subpet
```

`settings.py:78-83` 的 `ITEM_BGC` 字典中 `Empty`/`autofeed` 是 **UI 背景色分类**（空格与自动喂食格），不是物品 type。

### 6.2 物品字段完整表（`docs/art_dev.md:543-556`）

| 字段 | 默认值 | 可选值 | 说明 |
|------|--------|--------|------|
| `image` | 必填 | —— | 物品图片，建议正方形 |
| `effect_HP` | 0 | 任意整数 | 使用后饱食度变化，负数为下降 |
| `effect_FV` | 0 | 任意整数 | 使用后好感度变化，负数为下降 |
| `drop_rate` | 0 | 任意实数 | **相对权重**（非概率），不必 ≤1 |
| `fv_lock` | 1 | 0-7 整数 | 商店解锁所需好感度等级 |
| `description` | `""` | 文本 | 物品描述 |
| `type` | `consumable` | 4 种 | 物品类型 |
| `fv_reward` | `[]` | 0-7 整数 List | 升至指定等级时自动奖励该物品 |
| `pet_limit` | `[]` | 角色名 List | 限定角色可获得，程序自动过滤不存在的角色名 |
| `cost` | `50*(fv_lock+1)` | 正整数 或 -1 | 商店价格；**-1 表示不出现在商店** |
| `buff` | `{}` | —— | Buff 配置 |

关键修正：`cost` 默认值为 `50*(fv_lock+1)`（原报告未提及），而非固定值；`-1` 是「不可售」哨兵值，`ShopView._init_items` 会过滤（`dashboard_widgets.py:1804`）。

### 6.3 Buff effect 的 5 种类型（`docs/art_dev.md:575-582`）

| effect | 说明 | 必填参数 |
|--------|------|----------|
| `hp` | expiration 秒内每 interval 秒增加 value 饱食度（可负） | effect, value, interval, expiration |
| `fv` | expiration 秒内每 interval 秒增加 value 好感度（可负） | effect, value, interval, expiration |
| `coin` | expiration 秒内每 interval 秒增加 value 金币 | effect, value, interval, expiration；**value 不可为负** |
| `HP_stop` | 停止饱食度下降，持续 expiration 秒 | effect, expiration |
| `FV_stop` | 饿昏状态下也能停止好感度下降，持续 expiration 秒 | effect, expiration |

`HP_stop`/`FV_stop` 与 `hp`/`fv` 的区别：前者是「停止衰减」型（BuffAlt），后者是「主动增加」型（BuffAdd）。SpiritPal 的 `buffManager.ts` 已正确区分这两类（`buffManager.ts:4-7`）。

### 6.4 类型特定约束（`docs/art_dev.md:566-571`）

| 类型 | 禁止字段 | 推荐字段 |
|------|----------|----------|
| `consumable` | 无 | 全字段可用 |
| `collection` | 不填 `effect_HP`/`effect_FV`；建议不填 `drop_rate`/`buff` | `fv_reward` |
| `dialogue` | 不填 `effect_HP`/`effect_FV`/`buff` | `fv_reward`、`pet_limit` |
| `subpet` | 不填 `effect_HP`/`effect_FV`/`drop_rate` | 强烈建议 `buff` |

### 6.5 对话物品的额外绑定（`docs/art_dev.md:705-723`）

对话物品需要在 `pet_conf.json` 中通过 `msg_dict` 绑定到 `msg_conf.json` 的对话：

```json
{
    "msg_dict": {
        "纳西妲的信": "对话1"
    }
}
```

加载时 `conf.py:198-202` 会将 Value 替换为完整对话 dict，运行时 `DyberPet.py:1509-1515` 通过 `item_name in self.pet_conf.msg_dict` 判定是否为对话物品。

### 6.6 金币物品的特殊 schema（`res/items/Default/items_config.json:50-59`）

```json
"coin": {
    "name": {"zh_CN":"啵币", "en_US":"Dyber Coin"},
    "image": "coin.svg",
    "type": "coin",
    "drop_rate": 0,
    "cost": -1
}
```

金币本身也是物品 dict 的一项，但 `type` 为 `coin`（不在 4 种玩家可持有类型中），`cost: -1` 确保不出现在商店，`conf.py:1361-1364` 对其特殊处理提取 `coin` 元数据。

### 6.7 角色自定义金币（`docs/art_dev.md:180-188`）

```json
"coin_config": {
    "name": {"zh_CN":"摩拉", "en_US":"Mora"},
    "image": "info/mola.png"
}
```

`pet_conf.json` 的 `coin_config` 允许每个角色自定义金币名称与图标，`coinWidget`（`dashboard_widgets.py:754`）实时读取 `settings.items_data.coin` 渲染。

---

## 7. 与 SpiritPal 的对比及建议

本节针对 §2-§6 的新发现，逐项给出优先级、SpiritPal 现状、移植难度与建议 Phase。

### 7.1 对话系统

| 维度 | 内容 |
|------|------|
| **优先级** | P1 |
| **DyberPet 实现** | `msg_conf.json` 有向图 + `DPDialogue`（`custom_widgets.py:77-318`）+ `msg_dict` 绑定（`conf.py:194-204`） |
| **SpiritPal 现状** | 无对话系统。`spiritpal-app/src/lib/items.ts` 仅定义 `type: 'food'`，无 `dialogue` 类型；无对话框 UI 组件 |
| **移植难度** | 中 |
| **关键工作** | 1) 扩展 `InventoryItem` 类型支持 `dialogue`；2) 设计 `msg_conf.json` 的 TS schema 与有向图遍历器（复刻 `OptionGenerator`/`confirm`）；3) 实现对话框 React 组件（可拖拽 + 选项按钮 + Back 回溯）；4) 对话内容与角色的绑定配置 |
| **建议 Phase** | Phase 2（养成内容扩展期） |
| **注意事项** | DyberPet 的 Back 逻辑会污染原始 `relationship`（动态注入 `option_prev_*`），移植时应改为 **不修改原数据** 的栈式回溯（维护 `history: text_key[]`）。DyberPet 无条件分支，SpiritPal 可考虑增强为基于好感度/任务状态的条件分支 |

### 7.2 收藏系统

| 维度 | 内容 |
|------|------|
| **优先级** | P1 |
| **DyberPet 实现** | `collection` 类型 + `clct_inuse` 切换语义（`dashboard_widgets.py:1875-1879`）+ 与 `dialogue` 共用 Tab |
| **SpiritPal 现状** | `items.ts` 的 `InventoryItem.type` 仅 `'food'`，无 `collection`/`subpet`；无收藏 Tab；无「装备/卸下」语义 |
| **移植难度** | 中 |
| **关键工作** | 1) 扩展 `InventoryItem.type` 联合类型；2) 背包 UI 增加收藏 Tab；3) 实现 `clct_inuse` 切换（收藏品不扣减数量）；4) `fv_reward` 升级奖励发放逻辑 |
| **建议 Phase** | Phase 2 |
| **注意事项** | 收藏品的核心价值是「成就感/纪念」，建议 SpiritPal 结合成就系统设计（DyberPet 无独立成就系统，收藏品即成就） |

### 7.3 商店 UI

| 维度 | 内容 |
|------|------|
| **优先级** | P0（核心养成闭环） |
| **DyberPet 实现** | `shopInterface` + `ShopView` + `ShopItemWidget` + `ShopMessageBox`（`shopUI.py:27-318`、`dashboard_widgets.py:1495-2090`） |
| **SpiritPal 现状** | `items.ts` 已有 `price`/`fvLock`/`count` 字段，但 **无商店 UI**、无买卖流程、无锁定状态判定 |
| **移植难度** | 中 |
| **关键工作** | 1) 商店页面（商品卡片流式布局 + 搜索 + 筛选）；2) 锁定状态机（`FVLOCK`/`PETLIMIT`/`NONE`）；3) 买卖数量弹窗 + 金币实时计算；4) 卖出贬值（`ITEM_DEPRECIATION = 0.75`）；5) 非消耗品限购 1 个 |
| **建议 Phase** | Phase 1（与金币系统同步落地） |
| **注意事项** | DyberPet 的搜索为前缀倒排表（`dashboard_widgets.py:1830-1833`），SpiritPal 可直接用字符串 `includes` 简化。锁定视觉（Silhouette 剪影 + MaskPhrase 名称遮罩）是不错的 UX，建议保留 |

### 7.4 气泡配置系统

| 维度 | 内容 |
|------|------|
| **优先级** | P1 |
| **DyberPet 实现** | `BubbleManager`（`bubbleManager.py:51-205`）+ `bubble_conf.json` 8+1 类型 + HP 分级候选 + `USERTAG`/`ITEMNAME` 占位 |
| **SpiritPal 现状** | `spiritpal-app/src/lib/` 无 `bubbleManager.ts`；无气泡 UI |
| **移植难度** | 低 |
| **关键工作** | 1) `bubbleManager.ts` 移植（配置合并 + HP 分级候选 + trigger）；2) 气泡 React 组件（图标 + 文字 + 倒计时）；3) `USERTAG` 占位符替换；4) `feed_required` 候选物品筛选逻辑 |
| **建议 Phase** | Phase 2 |
| **注意事项** | `countdown` 字段是原报告未提及的能力，`feed_required` 用 120s 倒计时营造「限时投喂」紧迫感，建议 SpiritPal 保留。DyberPet 仅 tier 0/1/2 有候选，tier 3（活力）无气泡——这是合理的（满状态不打扰用户） |

### 7.5 物品 Schema 扩展

| 维度 | 内容 |
|------|------|
| **优先级** | P0（基础设施） |
| **DyberPet 实现** | 4 真实类型 + `cost` 默认公式 + `pet_limit` + `fv_reward` + 5 种 Buff effect（`docs/art_dev.md:543-582`） |
| **SpiritPal 现状** | `items.ts` 的 `InventoryItem` 字段：`id/name/icon/type/hungerRestore/moodRestore/price/count/fvLock/dropRate/description`。**缺失**：`collection`/`dialogue`/`subpet` 类型、`buff` 字段、`pet_limit`、`fv_reward`、`cost=-1` 哨兵 |
| **移植难度** | 低 |
| **关键工作** | 1) `InventoryItem.type` 扩展为 `'food' | 'collection' | 'dialogue' | 'subpet'`；2) 增加 `buff?: BuffConfig` 字段（SpiritPal 已有 `buffManager.ts`，schema 可直接复用）；3) 增加 `petLimit?: string[]`、`fvReward?: number[]`；4) 明确 `cost` 与 `price` 的语义统一（DyberPet 用 `cost`，SpiritPal 用 `price`） |
| **建议 Phase** | Phase 1（与商店 UI 同步） |
| **注意事项** | DyberPet 的 `drop_rate` 是 **相对权重**（非概率），SpiritPal 现有 `dropRate` 字段语义需确认是否一致。建议统一为相对权重，归一化在运行时计算 |

### 7.6 金币自定义

| 维度 | 内容 |
|------|------|
| **优先级** | P2 |
| **DyberPet 实现** | `pet_conf.json` 的 `coin_config`（`docs/art_dev.md:180-188`）+ `coinWidget` 动态渲染（`dashboard_widgets.py:727-784`） |
| **SpiritPal 现状** | `items.ts` 无金币自定义；金币为硬编码 |
| **移植难度** | 低 |
| **关键工作** | 角色配置增加 `coinConfig: {name, image}`，金币显示组件读取角色配置 |
| **建议 Phase** | Phase 3（锦上添花） |

### 7.7 优先级与 Phase 汇总

| # | 模块 | 优先级 | 移植难度 | 建议 Phase | SpiritPal 对应文件 |
|---|------|--------|----------|-----------|-----------------|
| 1 | 物品 Schema 扩展 | P0 | 低 | Phase 1 | `spiritpal-app/src/lib/items.ts`、`types.ts` |
| 2 | 商店 UI | P0 | 中 | Phase 1 | 新建 `shop.tsx` / `shopManager.ts` |
| 3 | 对话系统 | P1 | 中 | Phase 2 | 新建 `dialogueManager.ts` / `Dialogue.tsx` |
| 4 | 收藏系统 | P1 | 中 | Phase 2 | 扩展 `items.ts` + 背包 UI |
| 5 | 气泡配置系统 | P1 | 低 | Phase 2 | 新建 `bubbleManager.ts` / `Bubble.tsx` |
| 6 | 金币自定义 | P2 | 低 | Phase 3 | 扩展角色配置 + 金币组件 |

### 7.8 移植建议总结

1. **Phase 1 优先闭环金币-商店-物品**：SpiritPal 已有 `taskManager.ts`（任务奖励金币）和 `buffManager.ts`（Buff 系统），缺的是「金币消费出口」。商店 UI + 物品 schema 扩展是 Phase 1 的核心，能立即形成「任务赚金币 → 商店买物品 → 使用物品触发 Buff」的完整养成闭环。

2. **Phase 2 补充内容深度**：对话系统与收藏系统是「内容承载」模块，没有它们养成只是数值堆叠。对话系统尤其能增强角色代入感（DyberPet 的纳西妲信件是典型用例）。气泡系统则是「被动反馈」层，提升日常陪伴感。

3. **移植时的改进点**：
   - 对话系统：用 **栈式回溯** 替代 DyberPet 的 `option_prev_*` 注入（避免污染原数据）
   - 对话系统：可增加 **条件分支**（基于好感度/任务/拥有物品），DyberPet 未实现但需求明确
   - 商店搜索：用 `String.includes` 替代前缀倒排表（性能足够，代码更简）
   - 气泡系统：保留 `countdown` 能力（限时投喂机制）

4. **不建议移植的部分**：
   - DyberPet 的 `Silhouette`/`MaskPhrase` 实现较重（QPainter 合成），Web 端用 CSS `filter: grayscale(1)` + `opacity` 即可达成类似效果
   - DyberPet 的 `ITEM_BGC` 6 类背景色中 `Empty`/`autofeed` 是 UI 占位，SpiritPal 不必照搬

---

## 附录：关键文件索引

| 文件 | 关键行 | 内容 |
|------|--------|------|
| `DyberPet/custom_widgets.py` | 77-318 | `DPDialogue` 对话框 UI |
| `DyberPet/Accessory.py` | 127-138 | 对话附件调度与去重 |
| `DyberPet/conf.py` | 194-204 | `msg_conf.json` 加载与 `msg_dict` 解析 |
| `DyberPet/conf.py` | 1357-1404 | 物品字段解析 |
| `DyberPet/DyberPet.py` | 1489-1530 | `use_item` 物品使用分支 |
| `DyberPet/Dashboard/shopUI.py` | 27-318 | `shopInterface` 商店主容器 |
| `DyberPet/Dashboard/dashboard_widgets.py` | 727-784 | `coinWidget` 金币组件 |
| `DyberPet/Dashboard/dashboard_widgets.py` | 1495-1714 | `ShopItemWidget` 商品卡片 |
| `DyberPet/Dashboard/dashboard_widgets.py` | 1768-1904 | `ShopView` 商品列表 |
| `DyberPet/Dashboard/dashboard_widgets.py` | 2048-2090 | `ShopMessageBox` 买卖弹窗 |
| `DyberPet/Dashboard/inventoryUI.py` | 55, 110-112 | 背包 Tab 归属 |
| `DyberPet/Dashboard/inventoryUI.py` | 341-343 | 收藏品掉落 |
| `DyberPet/extra_windows.py` | 2389-2407 | 背包使用分支（collection/dialogue） |
| `DyberPet/bubbleManager.py` | 51-205 | `BubbleManager` 气泡管理器 |
| `DyberPet/settings.py` | 58, 65, 78-83 | `ITEM_DEPRECIATION`/`FACTOR_FEED_REQ`/`ITEM_BGC` |
| `res/icons/bubble_conf.json` | 1-58 | 系统默认气泡配置 |
| `res/items/Default/items_config.json` | 50-59 | 金币物品特殊 schema |
| `docs/art_dev.md` | 498-623 | 物品 schema 完整文档 |
| `docs/art_dev.md` | 617-723 | 对话系统开发文档 |
| `docs/art_dev.md` | 349-417 | 气泡系统开发文档 |
| `docs/art_dev.md` | 180-188 | 自定义金币配置 |

---

> 报告结束。本补充报告与 `DyberPet_Repo_Analysis.md` 配合使用，共同构成 DyberPet 开源仓库的完整技术分析。
