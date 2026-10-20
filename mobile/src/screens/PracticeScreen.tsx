import React from "react";
import { View } from "react-native";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  GraduationCap,
  MessagesSquare,
  Mic,
  Target,
} from "lucide-react-native";
import { artwork, colors as c } from "../theme";
import {
  Button,
  Card,
  go,
  Mascot,
  MenuRow,
  PreviewNote,
  Row,
  Screen,
  Section,
  T,
} from "../components/ui";
import { InterviewRow } from "./HomeScreen";
import { interviews } from "../data/demo";

export default function PracticeScreen() {
  return (
    <Screen title="练习室" right={<Mascot image={artwork.interviewer} />}>
      <Card style={{ gap: 18 }}>
        <Row>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: c.blueLight,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Mic size={22} color={c.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <T size={19} weight="700">
              开始一场模拟面试
            </T>
            <T size={11} color={c.muted}>
              配置岗位、语言和面试类型
            </T>
          </View>
        </Row>
        <Row style={{ gap: 13, flexWrap: "wrap" }}>
          <Row style={{ gap: 4 }}>
            <Clock3 size={12} color={c.muted} />
            <T size={10} color={c.muted}>
              10–30 分钟
            </T>
          </Row>
          <T size={10} color={c.muted}>
            中 / 英 / 德
          </T>
          <T size={10} color={c.muted}>
            300 能量 / 场
          </T>
        </Row>
        <Button tone="blue" icon={ArrowRight} onPress={() => go("/setup")}>
          设置我的面试
        </Button>
      </Card>
      <View style={{ gap: 12 }}>
        <Section title="面试类型" />
        <Card style={{ paddingVertical: 3 }}>
          <MenuRow
            icon={MessagesSquare}
            title="HR 与行为面试"
            subtitle="动机、团队合作、你的项目故事"
            tone="blue"
            onPress={() => go("/setup?type=HR")}
          />
          <View style={{ height: 1, backgroundColor: c.inset }} />
          <MenuRow
            icon={Target}
            title="技术与专业面试"
            subtitle="展示专业能力，也讲清思考过程"
            tone="lavender"
            onPress={() => go("/setup?type=technical")}
          />
          <View style={{ height: 1, backgroundColor: c.inset }} />
          <MenuRow
            icon={GraduationCap}
            title="综合模拟面试"
            subtitle="完整体验一场面试的节奏"
            tone="green"
            onPress={() => go("/setup?type=mixed")}
          />
        </Card>
      </View>
      <Card
        onPress={() => go("/notes")}
        label="打开题目闪卡"
        style={{ backgroundColor: c.greenLight, borderWidth: 0 }}
      >
        <Row>
          <BookOpen size={24} color={c.green} />
          <View style={{ flex: 1, gap: 4 }}>
            <T size={15} weight="700">
              题目闪卡
            </T>
            <T size={11} color={c.muted}>
              查看并复习收藏的面试题
            </T>
          </View>
          <ArrowRight size={19} color={c.green} />
        </Row>
      </Card>
      <View style={{ gap: 12 }}>
        <Section
          title="最近练习"
          action="全部"
          onPress={() => go("/history")}
        />
        {interviews.slice(0, 2).map((item) => (
          <InterviewRow key={item.id} item={item} />
        ))}
      </View>
      <PreviewNote />
    </Screen>
  );
}
