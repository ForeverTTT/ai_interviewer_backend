import React, { useState } from "react";
import { Pressable, View } from "react-native";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react-native";
import { colors as c } from "../theme";
import { questions } from "../data/demo";
import { useDemo } from "../state";
import {
  Button,
  Choices,
  Empty,
  go,
  IconButton,
  Pill,
  PreviewNote,
  Row,
  Screen,
  T,
} from "../components/ui";

export default function NotesScreen() {
  const { mastered, toggleMastered, saved } = useDemo();
  const [filter, setFilter] = useState("全部");
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const list = questions.filter(
    (q) =>
      saved.includes(q.id) &&
      (filter === "全部" ||
        (filter === "已掌握"
          ? mastered.includes(q.id)
          : !mastered.includes(q.id))),
  );
  const currentIndex = Math.min(index, Math.max(0, list.length - 1));
  const question = list[currentIndex];
  const change = (delta: number) => {
    setIndex((currentIndex + delta + list.length) % list.length);
    setFlipped(false);
  };
  return (
    <Screen
      title="题目闪卡"
      back
      right={
        <Pill>
          {questions.filter((q) => mastered.includes(q.id)).length} 道已掌握
        </Pill>
      }
    >
      <T size={12} color={c.muted}>
        点击卡片查看回答思路，复习后可标记为已掌握。
      </T>
      <Choices
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setIndex(0);
          setFlipped(false);
        }}
        options={["全部", "待复习", "已掌握"]}
        tone="green"
      />
      {question ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={flipped ? "查看问题" : "翻卡查看思路"}
            onPress={() => setFlipped(!flipped)}
            style={{
              minHeight: 340,
              borderRadius: 28,
              backgroundColor: flipped ? c.greenLight : c.card,
              borderColor: "#E6E9DD",
              borderWidth: 1,
              padding: 26,
              gap: 22,
              justifyContent: "space-between",
            }}
          >
            <Row style={{ justifyContent: "space-between" }}>
              <Pill>{question.category}</Pill>
              <T size={11} color={c.muted}>
                {String(currentIndex + 1).padStart(2, "0")} /{" "}
                {String(list.length).padStart(2, "0")}
              </T>
            </Row>
            <View style={{ gap: 15 }}>
              {flipped ? (
                <>
                  <T size={13} weight="700" color={c.green}>
                    让回答更有说服力
                  </T>
                  <T size={18} style={{ lineHeight: 31 }}>
                    {question.answer}
                  </T>
                </>
              ) : (
                <>
                  <T size={25} weight="700" style={{ lineHeight: 38 }}>
                    {question.question}
                  </T>
                  <T size={13} color={c.muted}>
                    {question.english}
                  </T>
                </>
              )}
            </View>
            <Row style={{ justifyContent: "space-between" }}>
              <T size={10} color={c.muted}>
                {question.company}
              </T>
              <Row style={{ gap: 5 }}>
                <RotateCcw size={12} color={c.green} />
                <T size={10} color={c.green}>
                  {flipped ? "点击看问题" : "点击翻卡"}
                </T>
              </Row>
            </Row>
          </Pressable>
          <Row style={{ justifyContent: "center", gap: 24 }}>
            <IconButton
              icon={ArrowLeft}
              label="上一张"
              onPress={() => change(-1)}
            />
            <T size={12} color={c.muted}>
              {currentIndex + 1} / {list.length}
            </T>
            <IconButton
              icon={ArrowRight}
              label="下一张"
              onPress={() => change(1)}
            />
          </Row>
          <Button
            icon={Check}
            variant={mastered.includes(question.id) ? "soft" : "solid"}
            onPress={() => {
              toggleMastered(question.id);
              setFlipped(false);
            }}
          >
            {mastered.includes(question.id)
              ? "已掌握 · 标回待复习"
              : "这题我掌握了"}
          </Button>
          <Button variant="outline" onPress={() => go("/setup")}>
            围绕这道题，再练一次
          </Button>
        </>
      ) : (
        <Empty
          title={filter === "已掌握" ? "暂无已掌握题目" : "这里暂时没有题目"}
          text={
            filter === "已掌握"
              ? "复习后点击「这题我掌握了」就会出现在这里。"
              : "可以切换筛选，或去面试报告收藏题目。"
          }
        />
      )}
      <PreviewNote>收藏和掌握状态在本次预览会话中保留。</PreviewNote>
    </Screen>
  );
}
