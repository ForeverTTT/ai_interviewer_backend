import React, { useState } from "react";
import { Switch, View } from "react-native";
import { router } from "expo-router";
import {
  Bell,
  CheckCircle2,
  Globe,
  Palette,
  ShieldCheck,
  Sparkles,
} from "lucide-react-native";
import { artwork, colors as c } from "../theme";
import { interviews } from "../data/demo";
import { useDemo } from "../state";
import {
  Button,
  Card,
  Choices,
  Field,
  go,
  Mascot,
  MenuRow,
  Pill,
  PreviewNote,
  Row,
  Screen,
  Section,
  T,
} from "../components/ui";
import { InterviewRow } from "./HomeScreen";

export function HistoryScreen() {
  return (
    <Screen title="练习记录" back right={<Mascot image={artwork.mentor} />}>
      <Card style={{ backgroundColor: c.greenLight, borderWidth: 0 }}>
        <Row style={{ justifyContent: "space-around" }}>
          {[
            ["12", "累计练习"],
            ["185", "练习分钟"],
            ["+11", "准备度提升"],
          ].map(([n, label]) => (
            <View key={label} style={{ alignItems: "center", gap: 5 }}>
              <T size={28} weight="700" color={c.greenDark}>
                {n}
              </T>
              <T size={10} color={c.muted}>
                {label}
              </T>
            </View>
          ))}
        </Row>
      </Card>
      <Section title="十月" />
      {interviews.map((item) => (
        <InterviewRow key={item.id} item={item} />
      ))}
      <PreviewNote>记录和统计均为样式示例。</PreviewNote>
    </Screen>
  );
}
export function GoalScreen() {
  const { target, setTarget } = useDemo();
  const [value, setValue] = useState(target);
  const [frequency, setFrequency] = useState("每周 3 次");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <Screen title="求职目标" back right={<Mascot image={artwork.mentor} />}>
      <Field
        label="目标岗位"
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setError("");
          setSaved(false);
        }}
        placeholder="你想申请的岗位"
      />
      <Choices
        label="练习频率"
        options={["每周 3 次", "每周 5 次", "每天"]}
        value={frequency}
        onChange={setFrequency}
        tone="green"
      />
      {Boolean(error) && (
        <T color={c.danger} size={12}>
          {error}
        </T>
      )}
      {saved && (
        <T color={c.green} size={12}>
          目标已在本次预览中更新，首页与个人页会同步显示。
        </T>
      )}
      <Button
        onPress={() => {
          if (!value.trim()) {
            setError("请填写目标岗位。");
            return;
          }
          setTarget(value.trim());
          setSaved(true);
        }}
      >
        保存我的目标
      </Button>
      <PreviewNote>练习频率为交互示意，尚未生成真实训练计划。</PreviewNote>
    </Screen>
  );
}
export function SettingsScreen() {
  const { name, setName } = useDemo();
  const [value, setValue] = useState(name);
  const [remind, setRemind] = useState(true);
  const [message, setMessage] = useState("");
  return (
    <Screen title="设置与个人资料" back>
      <Section title="个人资料" />
      <Field
        label="昵称"
        value={value}
        onChangeText={(text) => {
          setValue(text);
          setMessage("");
        }}
        placeholder="你的昵称"
      />
      <Button
        onPress={() => {
          if (!value.trim()) {
            setMessage("请填写一个昵称。");
            return;
          }
          setName(value.trim());
          setMessage("昵称已在本次预览中更新。");
        }}
      >
        保存昵称
      </Button>
      {Boolean(message) && (
        <T size={12} color={c.green}>
          {message}
        </T>
      )}
      <Card style={{ paddingVertical: 0 }}>
        <MenuRow
          icon={Palette}
          title="外观"
          subtitle="当前版本：FlowLab 奶油浅色主题"
          tone="pink"
        />
        <MenuRow
          icon={Globe}
          title="界面语言"
          subtitle="当前预览：简体中文"
          tone="blue"
        />
        <MenuRow
          icon={Bell}
          title="练习提醒"
          subtitle="开关仅作交互演示，不发送通知"
          end={
            <Switch
              accessibilityLabel="练习提醒"
              value={remind}
              onValueChange={setRemind}
              trackColor={{ false: c.line, true: "#A8C39B" }}
              thumbColor={c.card}
            />
          }
        />
        <MenuRow
          icon={ShieldCheck}
          title="数据与隐私"
          subtitle="预览数据仅保存在内存，重新加载后重置"
        />
      </Card>
      <PreviewNote>FlowLab Mobile · UI preview 0.1</PreviewNote>
    </Screen>
  );
}
export function NotificationsScreen() {
  const [read, setRead] = useState(false);
  return (
    <Screen
      title="消息与提醒"
      back
      right={
        <Button
          variant="soft"
          style={{ minHeight: 34, paddingVertical: 5, paddingHorizontal: 12 }}
          onPress={() => setRead(true)}
        >
          {read ? "全部已读" : "全部已读标记"}
        </Button>
      }
    >
      {[
        {
          title: "今日练习提醒",
          text: "项目经历练习 · 预计 10 分钟。",
          icon: Sparkles,
          link: "/setup",
        },
        {
          title: "面试报告已生成",
          text: "SAP 综合面试的评分与逐题反馈已可查看。",
          icon: CheckCircle2,
          link: "/report?id=1",
        },
      ].map((item) => (
        <Card
          key={item.title}
          onPress={() => {
            setRead(true);
            go(item.link);
          }}
        >
          <Row>
            <item.icon color={c.green} size={20} />
            <T size={15} weight="700" style={{ flex: 1 }}>
              {item.title}
            </T>
            {!read && (
              <View
                style={{
                  height: 6,
                  width: 6,
                  borderRadius: 3,
                  backgroundColor: c.pink,
                }}
              />
            )}
          </Row>
          <T size={12} color={c.muted}>
            {item.text}
          </T>
          <T size={10} color={c.muted}>
            示例提醒
          </T>
        </Card>
      ))}
      <PreviewNote>这里只展示通知样式，尚未连接推送服务。</PreviewNote>
    </Screen>
  );
}
export function FeedbackScreen() {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("体验建议");
  const [sent, setSent] = useState(false);
  return (
    <Screen title="帮助与反馈" back right={<Mascot image={artwork.avatar} />}>
      <Choices
        options={["体验建议", "遇到问题", "想要的功能"]}
        value={category}
        onChange={setCategory}
        tone="green"
      />
      <Field
        label="反馈内容"
        value={text}
        onChangeText={(value) => {
          setText(value);
          setSent(false);
        }}
        placeholder="描述问题或建议…"
        multiline
      />
      <Button disabled={!text.trim()} onPress={() => setSent(true)}>
        预览反馈提交
      </Button>
      {sent && (
        <Card style={{ backgroundColor: c.greenLight }}>
          <T weight="700">反馈提交预览</T>
          <T size={12}>
            已展示提交成功状态。这条反馈尚未发送，重新加载后会清除。
          </T>
        </Card>
      )}
      <PreviewNote>当前为 UI 预览，不会发送反馈消息。</PreviewNote>
    </Screen>
  );
}
export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  return (
    <Screen title="登录 FlowLab" back right={<Mascot image={artwork.avatar} />}>
      <Pill tone="gold">登录界面预览 · 不需要输入真实密码</Pill>
      <Field
        label="邮箱"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
      />
      <Field
        label="密码"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="输入示例密码即可"
      />
      <Button
        onPress={() => {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setMessage("请输入有效的邮箱格式。");
            return;
          }
          if (password.length < 6) {
            setMessage("示例密码至少填写 6 位。");
            return;
          }
          setPassword("");
          setMessage("表单验证通过。真实登录将在接入 Supabase 后启用。");
        }}
      >
        登录
      </Button>
      {Boolean(message) && (
        <T size={12} color={c.blue}>
          {message}
        </T>
      )}
      <Row style={{ gap: 12 }}>
        <Button
          variant="outline"
          tone="blue"
          style={{ flex: 1 }}
          onPress={() => setMessage("Google 登录的原生授权流程将在后续接入。")}
        >
          Google
        </Button>
        <Button
          variant="outline"
          tone="blue"
          style={{ flex: 1 }}
          onPress={() => setMessage("Apple 登录的原生授权流程将在后续接入。")}
        >
          Apple
        </Button>
      </Row>
      <Button variant="soft" onPress={() => router.replace("/")}>
        继续浏览 UI 预览
      </Button>
      <PreviewNote>本版未连接账号服务，不会提交邮箱和密码。</PreviewNote>
    </Screen>
  );
}
