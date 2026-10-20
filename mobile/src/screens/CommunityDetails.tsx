import React, { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  ArrowRight,
  Bookmark,
  Check,
  Heart,
  MapPin,
  MessageCircle,
} from "lucide-react-native";
import { colors as c, toneColors } from "../theme";
import { experiences, jobs } from "../data/demo";
import { useDemo } from "../state";
import {
  Button,
  Card,
  Empty,
  Field,
  go,
  IconButton,
  Pill,
  PreviewNote,
  Row,
  Screen,
  Section,
  T,
} from "../components/ui";

export function ExperienceScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const item = experiences.find((e) => e.id === id);
  const { saved, toggleSaved } = useDemo();
  const [liked, setLiked] = useState(false);
  const [comment, setComment] = useState("");
  const [comments, setComments] = useState<string[]>([]);
  if (!item)
    return (
      <Screen title="面经" back>
        <Empty title="没有找到这篇面经" text="返回发现页，看看其他故事。" />
      </Screen>
    );
  return (
    <Screen
      title="面经详情"
      back
      right={
        <IconButton
          icon={Bookmark}
          label={saved.includes(item.id) ? "取消收藏面经" : "收藏面经"}
          color={saved.includes(item.id) ? c.gold : c.muted}
          onPress={() => toggleSaved(item.id)}
        />
      }
    >
      <Row>
        <Pill tone={item.color}>{item.company}</Pill>
        <Pill tone="gold">{item.language}面试</Pill>
      </Row>
      <T size={26} weight="700" style={{ lineHeight: 38 }}>
        {item.title}
      </T>
      <Row>
        <View
          style={{
            height: 40,
            width: 40,
            borderRadius: 20,
            backgroundColor: toneColors(item.color).soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <T weight="700" color={toneColors(item.color).main}>
            {item.avatar}
          </T>
        </View>
        <View>
          <T size={12} weight="600">
            {item.author}
          </T>
          <T size={10} color={c.muted}>
            {item.time} · 示例面经
          </T>
        </View>
      </Row>
      <T size={15} style={{ lineHeight: 29 }}>
        {item.body}
      </T>
      <Card style={{ backgroundColor: c.goldLight, borderWidth: 0 }}>
        <T size={15} weight="700">
          这场面试问了什么？
        </T>
        {item.questions.map((q, i) => (
          <T key={q} size={13}>
            {i + 1}. {q}
          </T>
        ))}
        <Button
          variant="outline"
          tone="gold"
          icon={ArrowRight}
          onPress={() => go("/setup")}
        >
          我也来练练
        </Button>
      </Card>
      <Row>
        <Button
          variant={liked ? "solid" : "soft"}
          tone="pink"
          icon={Heart}
          onPress={() => setLiked(!liked)}
          style={{ flex: 1 }}
        >
          {liked ? "已点赞 " : "有帮助 "}
          {item.likes + (liked ? 1 : 0)}
        </Button>
        <Button
          variant="soft"
          tone="gold"
          icon={Bookmark}
          onPress={() => toggleSaved(item.id)}
          style={{ flex: 1 }}
        >
          {saved.includes(item.id) ? "已收藏" : "收藏面经"}
        </Button>
      </Row>
      <Section title="留言" subtitle="预览留言仅保留在当前页面，不会发布。" />
      {comments.map((text, i) => (
        <Card key={i}>
          <T size={11} weight="700">
            我 · 本地预览
          </T>
          <T size={13}>{text}</T>
        </Card>
      ))}
      <Field
        label="你的想法"
        value={comment}
        onChangeText={setComment}
        placeholder="分享一点鼓励，或聊聊你的经历。"
        multiline
      />
      <Button
        variant="soft"
        tone="gold"
        disabled={!comment.trim()}
        icon={MessageCircle}
        onPress={() => {
          setComments([...comments, comment.trim()]);
          setComment("");
        }}
      >
        添加预览留言
      </Button>
    </Screen>
  );
}

export function JobScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const job = jobs.find((j) => j.id === id);
  const { saved, toggleSaved } = useDemo();
  if (!job)
    return (
      <Screen title="岗位" back>
        <Empty title="没有找到这个岗位" text="返回岗位机会查看其他示例。" />
      </Screen>
    );
  return (
    <Screen
      title="岗位详情"
      back
      right={
        <IconButton
          icon={Bookmark}
          label={saved.includes(job.id) ? "取消收藏岗位" : "收藏岗位"}
          color={saved.includes(job.id) ? c.gold : c.muted}
          onPress={() => toggleSaved(job.id)}
        />
      }
      footer={
        <Button
          tone="blue"
          icon={ArrowRight}
          onPress={() => go("/setup?role=" + encodeURIComponent(job.title))}
        >
          为这个岗位练一场
        </Button>
      }
    >
      <View
        style={{
          width: 67,
          height: 67,
          borderRadius: 20,
          backgroundColor: toneColors(job.color).soft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <T size={24} weight="700" color={toneColors(job.color).main}>
          {job.initial}
        </T>
      </View>
      <View style={{ gap: 8 }}>
        <T size={13} color={c.muted}>
          {job.company}
        </T>
        <T size={27} weight="700">
          {job.title}
        </T>
        <Row>
          <MapPin size={13} color={c.muted} />
          <T size={12} color={c.muted}>
            {job.city} · {job.mode}
          </T>
        </Row>
        <Row>
          <Pill tone="gold">{job.type}</Pill>
          <Pill tone="blue">{job.match}</Pill>
        </Row>
      </View>
      <Card style={{ backgroundColor: c.goldLight, borderWidth: 0 }}>
        <T size={13} weight="700">
          示例职位
        </T>
        <T size={12}>
          这是用于界面设计的岗位示例，没有真实投递入口。你可以体验收藏和针对性练习流程。
        </T>
      </Card>
      <Section title="岗位职责" />
      <T size={14} style={{ lineHeight: 27 }}>
        {job.description}
      </T>
      <Section title="岗位要求" />
      {job.requirements.map((text) => (
        <Row key={text} style={{ alignItems: "flex-start" }}>
          <Check size={17} color={c.green} />
          <T size={14} style={{ flex: 1 }}>
            {text}
          </T>
        </Row>
      ))}
      <Button variant="outline" tone="pink" onPress={() => go("/resume")}>
        看看我的简历如何匹配
      </Button>
      <PreviewNote>职位信息为展示示例。</PreviewNote>
    </Screen>
  );
}

export function SavedScreen() {
  const { saved } = useDemo();
  const posts = experiences.filter((e) => saved.includes(e.id));
  const vacancies = jobs.filter((j) => saved.includes(j.id));
  return (
    <Screen title="收藏的面经与岗位" back>
      <Section title="面经收藏" />
      {posts.length ? (
        posts.map((e) => (
          <Card key={e.id} onPress={() => go("/experience?id=" + e.id)}>
            <Pill tone="gold">{e.company}</Pill>
            <T size={17} weight="700">
              {e.title}
            </T>
            <T size={12} color={c.muted}>
              {e.author}
            </T>
          </Card>
        ))
      ) : (
        <Empty title="还没有收藏面经" text="在发现页，把喜欢的故事收起来。" />
      )}
      <Section title="岗位收藏" />
      {vacancies.length ? (
        vacancies.map((j) => (
          <Card key={j.id} onPress={() => go("/job?id=" + j.id)}>
            <T size={12} color={c.gold}>
              {j.company} · {j.city}
            </T>
            <T size={17} weight="700">
              {j.title}
            </T>
          </Card>
        ))
      ) : (
        <Empty title="还没有收藏岗位" text="在岗位机会里点击书签，即可收藏。" />
      )}
      <PreviewNote />
    </Screen>
  );
}
