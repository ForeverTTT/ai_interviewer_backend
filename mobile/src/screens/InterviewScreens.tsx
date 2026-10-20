import React, { useState } from "react";
import { Image, Modal, Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  ArrowRight,
  Bookmark,
  ChevronDown,
  FileText,
  Lightbulb,
  Mic,
  MicOff,
  Pause,
  Play,
  Send,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react-native";
import Svg, { Circle } from "react-native-svg";
import { artwork, colors as c } from "../theme";
import { useDemo } from "../state";
import { dimensions, interviews, questions } from "../data/demo";
import {
  Button,
  Card,
  Choices,
  Field,
  go,
  Mascot,
  IconButton,
  Pill,
  PreviewNote,
  Progress,
  Row,
  Screen,
  Section,
  T,
} from "../components/ui";

export function SetupScreen() {
  const params = useLocalSearchParams<{ type?: string; role?: string }>();
  const { target } = useDemo();
  const [role, setRole] = useState(params.role || target);
  const [jd, setJd] = useState("");
  const [type, setType] = useState(
    params.type === "HR"
      ? "HR 面试"
      : params.type === "technical"
        ? "技术面试"
        : "综合面试",
  );
  const [language, setLanguage] = useState("英语");
  const [mode, setMode] = useState("练习模式");
  const [duration, setDuration] = useState("20 分钟");
  const [difficulty, setDifficulty] = useState("适中");
  const [personality, setPersonality] = useState("温和鼓励");
  const [error, setError] = useState("");
  const start = () => {
    if (!role.trim()) {
      setError("先填写目标岗位，让教练更了解你。");
      return;
    }
    router.push({
      pathname: "/interview",
      params: {
        role: role.trim(),
        language,
        mode,
        duration,
        type,
        difficulty,
        personality,
      },
    });
  };
  return (
    <Screen
      title="设置这场面试"
      back
      right={<Mascot image={artwork.interviewer} />}
      footer={
        <>
          <Button tone="blue" icon={ArrowRight} onPress={start}>
            进入面试预览
          </Button>
          <T size={10} color={c.muted} style={{ textAlign: "center" }}>
            正式使用需 300 能量 · 本次预览不扣费
          </T>
        </>
      }
    >
      <Card>
        <Field
          label="目标岗位"
          value={role}
          onChangeText={(text) => {
            setRole(text);
            setError("");
          }}
          placeholder="例如 Product Designer"
        />
        {Boolean(error) && (
          <T size={12} color={c.danger}>
            {error}
          </T>
        )}
        <Field
          label="岗位描述 JD（选填）"
          value={jd}
          onChangeText={setJd}
          placeholder="粘贴岗位要求，教练会围绕它提问…"
          multiline
        />
        <Row>
          <FileText size={16} color={c.blue} />
          <T size={11} color={c.muted} style={{ flex: 1 }}>
            Hayden_CV.pdf · 示例简历
          </T>
          <Pressable
            accessibilityRole="button"
            onPress={() => go("/resume")}
            style={{ paddingVertical: 10 }}
          >
            <T size={11} color={c.blue}>
              管理简历
            </T>
          </Pressable>
        </Row>
      </Card>
      <Choices
        label="面试类型"
        value={type}
        onChange={setType}
        options={["综合面试", "HR 面试", "技术面试"]}
      />
      <Choices
        label="面试语言"
        value={language}
        onChange={setLanguage}
        options={["英语", "德语", "中文"]}
      />
      <View style={{ gap: 10 }}>
        <Choices
          label="练习方式"
          value={mode}
          onChange={setMode}
          options={["练习模式", "正式模拟"]}
        />
        <T size={11} color={c.muted}>
          {mode === "练习模式"
            ? "随时暂停、查看提示，按自己的节奏来。"
            : "模拟真实面试节奏，结束后统一查看反馈。"}
        </T>
      </View>
      <Choices
        label="面试时长"
        value={duration}
        onChange={setDuration}
        options={["10 分钟", "20 分钟", "30 分钟"]}
      />
      <Choices
        label="难度"
        value={difficulty}
        onChange={setDifficulty}
        options={["轻松热身", "适中", "挑战一下"]}
      />
      <Choices
        label="教练风格"
        value={personality}
        onChange={setPersonality}
        options={["温和鼓励", "专业直接", "深入追问"]}
      />
      <PreviewNote>本版仅演示界面，JD 不会上传或用于生成问题。</PreviewNote>
    </Screen>
  );
}

export function InterviewScreen() {
  const params = useLocalSearchParams<{
    role?: string;
    language?: string;
    mode?: string;
    duration?: string;
    type?: string;
    difficulty?: string;
    personality?: string;
  }>();
  const [listening, setListening] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sound, setSound] = useState(true);
  const [answer, setAnswer] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [hint, setHint] = useState(false);
  const [ending, setEnding] = useState(false);
  const language = params.language || "英语";
  const firstQuestion =
    language === "德语"
      ? "Erzählen Sie mir von einem Projekt, auf das Sie besonders stolz sind."
      : language === "中文"
        ? "请介绍一个让你感到自豪的项目，以及你在其中的贡献。"
        : "Tell me about a project you’re proud of, and the role you played in it.";
  const followup =
    language === "德语"
      ? "Was war die größte Herausforderung in diesem Projekt?"
      : language === "中文"
        ? "这个项目中，你遇到的最大挑战是什么？"
        : "What was the biggest challenge you faced in that project?";
  const send = () => {
    if (!answer.trim() || paused) return;
    setMessages([...messages, answer.trim()]);
    setAnswer("");
  };
  return (
    <Screen
      title="面试进行中"
      back
      right={
        <Pill tone="blue" small>
          演示对话
        </Pill>
      }
      footer={
        <View style={{ gap: 10 }}>
          <Row style={{ justifyContent: "space-around" }}>
            <IconButton
              icon={sound ? Volume2 : VolumeX}
              label={sound ? "关闭声音演示" : "打开声音演示"}
              onPress={() => setSound(!sound)}
              background={c.blueLight}
              color={c.blue}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={listening ? "停止录音演示" : "开始录音演示"}
              disabled={paused}
              onPress={() => setListening(!listening)}
              style={{
                height: 66,
                width: 66,
                borderRadius: 33,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: listening ? c.pink : c.blue,
                opacity: paused ? 0.4 : 1,
              }}
            >
              {listening ? (
                <MicOff size={27} color="#FFFFFF" />
              ) : (
                <Mic size={27} color="#FFFFFF" />
              )}
            </Pressable>
            <IconButton
              icon={paused ? Play : Pause}
              label={paused ? "继续练习" : "暂停练习"}
              onPress={() => {
                setPaused(!paused);
                setListening(false);
              }}
              background={c.blueLight}
              color={c.blue}
            />
            <IconButton
              icon={Square}
              label="结束练习"
              onPress={() => setEnding(true)}
              background={c.pinkLight}
              color={c.pink}
            />
          </Row>
          <T size={10} color={c.muted} style={{ textAlign: "center" }}>
            {paused
              ? "已暂停，可以慢慢整理思路"
              : listening
                ? "录音状态演示 · 未访问麦克风"
                : "点击麦克风体验语音状态，或输入文字"}
          </T>
        </View>
      }
    >
      <Row style={{ justifyContent: "space-between" }}>
        <View>
          <T size={15} weight="700">
            {params.role || "Product Designer"}
          </T>
          <T size={10} color={c.muted}>
            {language} · {params.mode || "练习模式"} ·{" "}
            {params.duration || "20 分钟"}
          </T>
        </View>
        <Pill tone="lavender">第 {messages.length ? "2" : "1"} 题</Pill>
      </Row>
      <View style={{ alignItems: "center", gap: 8, paddingVertical: 5 }}>
        <View
          style={{
            width: 180,
            height: 180,
            borderRadius: 90,
            backgroundColor: c.blueLight,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Image
            source={artwork.interviewer}
            style={{ width: 225, height: 168 }}
            resizeMode="contain"
          />
        </View>
        <T size={12} weight="700" color={c.blue}>
          壳仔 · 面试教练
        </T>
        <Row style={{ gap: 4, height: 22, justifyContent: "center" }}>
          {[7, 12, 20, 14, 9, 18, 22, 11, 16, 8, 13].map((height, index) => (
            <View
              key={index}
              style={{
                width: 3,
                height: paused ? 4 : height,
                backgroundColor: listening ? c.pink : c.lavender,
                borderRadius: 2,
                opacity: 0.65,
              }}
            />
          ))}
        </Row>
      </View>
      <Card style={{ backgroundColor: c.blueLight, borderWidth: 0 }}>
        <T size={10} color={c.blue} weight="700">
          {messages.length ? "示例追问" : "项目经历 · 示例问题"}
        </T>
        <T size={20} weight="600" style={{ lineHeight: 31 }}>
          {messages.length ? followup : firstQuestion}
        </T>
        <T size={12} color={c.muted}>
          {messages.length
            ? "说说你面对挑战时的思考和行动。"
            : "选一个真实的项目，慢慢讲给我听。"}
        </T>
      </Card>
      {messages.map((message, index) => (
        <Card
          key={index}
          style={{ backgroundColor: "#F0EEE8", marginLeft: 25, borderWidth: 0 }}
        >
          <T size={10} color={c.muted}>
            我的回答
          </T>
          <T size={14}>{message}</T>
        </Card>
      ))}
      {params.mode !== "正式模拟" && (
        <View style={{ gap: 10 }}>
          <Pressable accessibilityRole="button" onPress={() => setHint(!hint)}>
            <Row>
              <Lightbulb size={17} color={c.gold} />
              <T size={12} color={c.gold}>
                {hint ? "收起回答思路" : "卡住了？看看回答思路"}
              </T>
            </Row>
          </Pressable>
          {hint && (
            <Card style={{ backgroundColor: c.goldLight, borderWidth: 0 }}>
              <T size={12}>
                试着用
                STAR：背景是什么？你的任务是什么？你具体做了什么？最后的结果如何？
              </T>
            </Card>
          )}
        </View>
      )}
      <Field
        label="也可以打字回答"
        value={answer}
        onChangeText={setAnswer}
        placeholder="从「当时我们遇到了…」开始"
        multiline
      />
      <Button
        tone="blue"
        variant="soft"
        icon={Send}
        disabled={!answer.trim() || paused}
        onPress={send}
      >
        发送回答 · 预览追问
      </Button>
      <PreviewNote>本页不录音、不调用 AI，回复为固定示例。</PreviewNote>
      <Modal
        visible={ending}
        transparent
        animationType="fade"
        onRequestClose={() => setEnding(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "#24263366",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Card style={{ width: "100%", maxWidth: 380, gap: 18 }}>
            <Row>
              <T size={20} weight="700" style={{ flex: 1 }}>
                这次练习，先到这里？
              </T>
              <IconButton
                icon={X}
                label="关闭"
                onPress={() => setEnding(false)}
              />
            </Row>
            <T size={13} color={c.muted}>
              你可以进入示例报告，看看练习后的复盘体验。
            </T>
            <Button
              onPress={() => {
                setEnding(false);
                router.replace("/report?id=demo");
              }}
            >
              结束并查看示例报告
            </Button>
            <Button
              tone="blue"
              variant="outline"
              onPress={() => setEnding(false)}
            >
              继续练习
            </Button>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

export function ReportScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const item = interviews.find((i) => i.id === id) || interviews[0];
  const [expanded, setExpanded] = useState<string | null>("q1");
  const { saved, toggleSaved, setCompletedToday } = useDemo();
  return (
    <Screen
      title="面试复盘"
      back
      right={<Pill small>示例报告</Pill>}
      footer={
        <Button
          icon={ArrowRight}
          onPress={() => {
            setCompletedToday(true);
            router.replace("/");
          }}
        >
          完成复盘，返回首页
        </Button>
      }
    >
      <View style={{ gap: 6 }}>
        <T size={23} weight="700">
          评估概览
        </T>
        <T size={12} color={c.muted}>
          {item.company} · {item.role} · {item.language}
        </T>
      </View>
      <Card style={{ alignItems: "center", paddingVertical: 25 }}>
        <View
          style={{
            width: 144,
            height: 144,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Svg
            width={144}
            height={144}
            style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}
          >
            <Circle
              cx={72}
              cy={72}
              r={61}
              fill="none"
              stroke={c.greenLight}
              strokeWidth={9}
            />
            <Circle
              cx={72}
              cy={72}
              r={61}
              fill="none"
              stroke={c.green}
              strokeWidth={9}
              strokeLinecap="round"
              strokeDasharray={(383.27 * item.score) / 100 + " 383.27"}
            />
          </Svg>
          <T size={43} weight="700">
            {item.score}
          </T>
          <T size={10} color={c.muted}>
            面试准备度 / 100
          </T>
        </View>
        <Pill>表达越来越有条理了</Pill>
        <T size={12} color={c.muted} style={{ textAlign: "center" }}>
          这份示例展示报告的样式，实际评价将来自你的回答。
        </T>
      </Card>
      <Card>
        <Section title="看看你的五维表现" />
        {dimensions.map((d) => (
          <View key={d.label} style={{ gap: 7 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <T size={12}>{d.label}</T>
              <T size={12} weight="700" color={c.green}>
                {d.score}
              </T>
            </Row>
            <Progress value={d.score} />
          </View>
        ))}
      </Card>
      <Card style={{ backgroundColor: c.greenLight, borderWidth: 0 }}>
        <Row>
          <Sparkles size={18} color={c.green} />
          <T size={15} weight="700">
            这次做得好的地方
          </T>
        </Row>
        <T size={13}>
          你清楚地交代了项目背景，也能用具体行动解释自己的贡献。继续保持这样的表达节奏。
        </T>
      </Card>
      <View style={{ gap: 12 }}>
        <Section title="逐题反馈" />
        {questions.slice(0, 2).map((q, index) => (
          <Card key={q.id}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={"展开第 " + (index + 1) + " 题"}
              onPress={() => setExpanded(expanded === q.id ? null : q.id)}
            >
              <Row>
                <Pill small>Q{index + 1}</Pill>
                <T size={14} weight="600" style={{ flex: 1 }}>
                  {q.question}
                </T>
                <ChevronDown size={17} color={c.muted} />
              </Row>
            </Pressable>
            {expanded === q.id && (
              <>
                <T size={11} color={c.muted}>
                  {q.english}
                </T>
                <View style={{ height: 1, backgroundColor: c.line }} />
                <T size={12} weight="700" color={c.green}>
                  下次可以这样表达
                </T>
                <T size={13}>{q.answer}</T>
                <Row>
                  <Button
                    style={{ flex: 1 }}
                    variant="soft"
                    icon={Bookmark}
                    onPress={() => toggleSaved(q.id)}
                  >
                    {saved.includes(q.id) ? "已收藏" : "收藏题目"}
                  </Button>
                  <Button
                    style={{ flex: 1 }}
                    variant="outline"
                    onPress={() => go("/setup")}
                  >
                    再练一次
                  </Button>
                </Row>
              </>
            )}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
