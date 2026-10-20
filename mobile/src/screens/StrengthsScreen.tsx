import React, { useState } from "react";
import { View } from "react-native";
import { ArrowRight, Compass, RotateCcw } from "lucide-react-native";
import { artwork, colors as c } from "../theme";
import {
  Button,
  Card,
  Choices,
  Mascot,
  Pill,
  PreviewNote,
  Progress,
  Row,
  Screen,
  T,
} from "../components/ui";

const statements = [
  "面对复杂问题，我喜欢先找到清晰的方向。",
  "我会把大目标拆成能马上开始的小步骤。",
  "我能觉察团队里不同人的感受。",
  "我乐于向别人解释并推动一个想法。",
  "我喜欢思考一个方案可能带来的长期影响。",
  "答应的事情，我通常会努力做到。",
  "与人合作时，我愿意先认真倾听。",
  "面对分歧，我愿意主动开启讨论。",
  "我能从零散的信息中发现联系。",
  "即使任务重复，我也会认真完成。",
  "我喜欢帮助伙伴发现自己的长处。",
  "向大家介绍一个新想法会让我兴奋。",
  "我会在做决定前比较不同的可能性。",
  "看到计划一步步落地，我会很有满足感。",
  "我愿意投入时间建立信任。",
  "我能够把复杂的事情讲得容易理解。",
  "我喜欢追问一个问题背后的原因。",
  "遇到困难时，我会寻找可行的下一步。",
  "团队的共同进步对我很重要。",
  "在需要的时候，我愿意承担带头的角色。",
];
export default function StrengthsScreen() {
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [finished, setFinished] = useState(false);
  const options = ["不太像我", "偶尔如此", "比较像我", "非常像我"];
  const reset = () => {
    setStarted(false);
    setFinished(false);
    setIndex(0);
    setAnswers({});
  };
  const domains = ["战略思维", "执行力", "关系建立", "影响力"]
    .map((name, offset) => ({
      name,
      score: Math.round(
        ([0, 1, 2, 3, 4].reduce(
          (sum, n) => sum + (options.indexOf(answers[n * 4 + offset]) + 1),
          0,
        ) /
          20) *
          100,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  return (
    <Screen title="优势探索" back right={<Mascot image={artwork.avatar} />}>
      {!started ? (
        <>
          <T size={14} color={c.muted} style={{ lineHeight: 25 }}>
            通过 20
            道题，查看战略思维、执行力、关系建立和影响力四个维度的自评结果。
          </T>
          <Card>
            <Row>
              <Compass size={21} color={c.gold} />
              <T weight="700">20 个问题 · 约 5 分钟</T>
            </Row>
            <T size={12} color={c.muted}>
              没有标准答案，选择更贴近自己的描述。
            </T>
          </Card>
          <Button
            tone="gold"
            icon={ArrowRight}
            onPress={() => setStarted(true)}
          >
            开始探索
          </Button>
        </>
      ) : finished ? (
        <>
          <Pill tone="gold">你的探索结果 · 交互演示</Pill>
          <T size={27} weight="700">
            {"你的选择，更偏向\n"}
            {domains[0].name}。
          </T>
          <Card>
            {domains.map((d) => (
              <View key={d.name} style={{ gap: 8 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <T size={14} weight="600">
                    {d.name}
                  </T>
                  <T size={12} color={c.gold}>
                    {d.score}
                  </T>
                </Row>
                <Progress value={d.score} tone="gold" />
              </View>
            ))}
          </Card>
          <Card style={{ backgroundColor: c.goldLight, borderWidth: 0 }}>
            <T size={16} weight="700">
              面试表达建议
            </T>
            <T size={13}>
              回想一次你表现出这个特点的经历：当时发生了什么？你做了什么？它帮助了谁？
            </T>
          </Card>
          <Button
            tone="gold"
            variant="outline"
            icon={RotateCcw}
            onPress={reset}
          >
            重新探索
          </Button>
        </>
      ) : (
        <>
          <Row style={{ justifyContent: "space-between" }}>
            <Pill tone="gold">选择符合实际情况的一项</Pill>
            <T size={12} color={c.muted}>
              {index + 1} / 20
            </T>
          </Row>
          <Progress value={(index + 1) * 5} tone="gold" />
          <Card
            style={{ minHeight: 220, justifyContent: "center", marginTop: 15 }}
          >
            <T size={12} color={c.gold}>
              问题 {String(index + 1).padStart(2, "0")}
            </T>
            <T size={25} weight="700" style={{ lineHeight: 39 }}>
              {statements[index]}
            </T>
          </Card>
          <Choices
            options={options}
            value={answers[index] || ""}
            onChange={(value) => setAnswers({ ...answers, [index]: value })}
            tone="gold"
          />
          <Button
            tone="gold"
            disabled={!answers[index]}
            icon={ArrowRight}
            onPress={() =>
              index === 19 ? setFinished(true) : setIndex(index + 1)
            }
          >
            {index === 19 ? "看看我的结果" : "下一题"}
          </Button>
          {index > 0 && (
            <Button
              variant="outline"
              tone="gold"
              onPress={() => setIndex(index - 1)}
            >
              上一题
            </Button>
          )}
        </>
      )}
      <PreviewNote>
        本版题目与计分用于 UI 演示，不是标准化心理测评。
      </PreviewNote>
    </Screen>
  );
}
