import React from "react";
import { Image, Pressable, View } from "react-native";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Flame,
  Mic,
  Sparkles,
  Target,
  Zap,
} from "lucide-react-native";
import { artwork, colors as c, toneColors } from "../theme";
import { useDemo } from "../state";
import { interviews } from "../data/demo";
import {
  Button,
  Card,
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
  ToolCard,
} from "../components/ui";

export function InterviewRow({ item }: { item: (typeof interviews)[number] }) {
  const tone = toneColors(item.color);
  return (
    <Card
      onPress={() => go("/report?id=" + item.id)}
      label={"查看 " + item.company + " 面试报告"}
      style={{ padding: 16 }}
    >
      <Row>
        <View
          style={{
            height: 45,
            width: 45,
            borderRadius: 14,
            backgroundColor: tone.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Mic size={20} color={tone.main} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <T size={14} weight="700">
            {item.company} · {item.role}
          </T>
          <T size={11} color={c.muted}>
            {item.date} · {item.language} · {item.duration}
          </T>
        </View>
        <T size={23} weight="700" color={c.green}>
          {item.score}
        </T>
        <ChevronRight size={14} color={c.muted} />
      </Row>
    </Card>
  );
}
export default function HomeScreen() {
  const { target, completedToday } = useDemo();
  return (
    <Screen contentStyle={{ paddingTop: 15 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Row style={{ gap: 7 }}>
          <Image source={artwork.icon} style={{ width: 31, height: 31 }} />
          <T size={23} weight="700" style={{ letterSpacing: -1 }}>
            FlowLab
            <T size={20} color={c.green}>
              .
            </T>
          </T>
          <Pill small>UI 预览</Pill>
        </Row>
        <IconButton
          icon={Bell}
          label="通知"
          onPress={() => go("/notifications")}
        />
      </Row>
      <Card style={{ gap: 15 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Row style={{ gap: 6 }}>
            <Mascot image={artwork.mentor} size={36} />
            <T size={13} color={c.green} weight="700">
              今日练习
            </T>
          </Row>
          <T size={11} color={c.muted}>
            约 10 分钟
          </T>
        </Row>
        <View style={{ gap: 5 }}>
          <T size={18} weight="700">
            {completedToday ? "今日练习已完成" : "项目经历表达"}
          </T>
          <T size={12} color={c.muted}>
            {completedToday
              ? "可继续模拟面试，或查看练习记录。"
              : "练习项目背景、个人贡献与结果的表达。"}
          </T>
        </View>
        <Button
          onPress={() => go("/setup")}
          icon={completedToday ? Check : ArrowRight}
        >
          {completedToday ? "继续练一场" : "开始今天的练习"}
        </Button>
        <Pressable accessibilityRole="button" onPress={() => go("/goal")}>
          <Row style={{ gap: 7 }}>
            <Target size={13} color={c.muted} />
            <T size={10} color={c.muted} style={{ flex: 1 }}>
              目标：{target}
            </T>
            <T size={10} color={c.green}>
              调整目标
            </T>
            <ChevronRight size={12} color={c.green} />
          </Row>
        </Pressable>
      </Card>
      <Row style={{ justifyContent: "space-around", paddingVertical: 2 }}>
        {[
          { n: "12", label: "累计练习", icon: Mic },
          { n: "5", label: "连续练习天数", icon: Flame },
          { n: "82", label: "最近准备度", icon: Sparkles },
        ].map(({ n, label, icon: Icon }) => (
          <View key={label} style={{ alignItems: "center", gap: 4 }}>
            <Row style={{ gap: 5 }}>
              <T size={27} weight="700">
                {n}
              </T>
              <Icon size={14} color={c.green} />
            </Row>
            <T size={10} color={c.muted}>
              {label}
            </T>
          </View>
        ))}
      </Row>
      <View style={{ gap: 13 }}>
        <Section title="常用工具" />
        <Row style={{ alignItems: "stretch", gap: 12 }}>
          <ToolCard
            title="面试练习"
            subtitle="模拟面试 · 复盘"
            image={artwork.interviewer}
            tone="blue"
            onPress={() => go("/practice")}
          />
          <ToolCard
            title="简历工作室"
            subtitle="诊断 · 优化 · 求职信"
            image={artwork.tailor}
            tone="pink"
            onPress={() => go("/resume")}
          />
        </Row>
        <Row style={{ gap: 12 }}>
          <Card
            onPress={() => go("/notes")}
            label="题目闪卡"
            style={{ flex: 1, padding: 15 }}
          >
            <Row>
              <BookOpen color={c.green} size={19} />
              <T size={13} weight="600">
                题目闪卡
              </T>
            </Row>
            <T size={10} color={c.muted}>
              收藏与复习面试题
            </T>
          </Card>
          <Card
            onPress={() => go("/strengths")}
            label="优势探索"
            style={{ flex: 1, padding: 15 }}
          >
            <Row>
              <Zap color={c.gold} size={19} />
              <T size={13} weight="600">
                优势探索
              </T>
            </Row>
            <T size={10} color={c.muted}>
              20 题自评
            </T>
          </Card>
        </Row>
      </View>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <T size={15} weight="700">
            本周练习
          </T>
          <Pill small>本周 {completedToday ? "4" : "3"} / 5 次</Pill>
        </Row>
        <Progress value={completedToday ? 80 : 60} />
        <Row style={{ justifyContent: "space-between" }}>
          {["一", "二", "三", "四", "五", "六", "日"].map((day, i) => (
            <View key={day} style={{ alignItems: "center", gap: 7 }}>
              <View
                style={{
                  height: 29,
                  width: 29,
                  borderRadius: 15,
                  backgroundColor:
                    i < (completedToday ? 4 : 3) ? c.greenLight : c.inset,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i < (completedToday ? 4 : 3) ? (
                  <Check size={14} color={c.green} />
                ) : (
                  <View
                    style={{
                      height: 4,
                      width: 4,
                      borderRadius: 2,
                      backgroundColor: c.line,
                    }}
                  />
                )}
              </View>
              <T size={10} color={c.muted}>
                {day}
              </T>
            </View>
          ))}
        </Row>
      </Card>
      <View style={{ gap: 12 }}>
        <Section
          title="最近的练习"
          action="全部记录"
          onPress={() => go("/history")}
        />
        <InterviewRow item={interviews[0]} />
      </View>
      <PreviewNote />
    </Screen>
  );
}
