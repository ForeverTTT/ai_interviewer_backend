import React, { useState } from "react";
import { Pressable, View } from "react-native";
import {
  Bookmark,
  Heart,
  MapPin,
  MessageCircle,
  SlidersHorizontal,
} from "lucide-react-native";
import { artwork, colors as c, toneColors } from "../theme";
import { experiences, jobs } from "../data/demo";
import { useDemo } from "../state";
import {
  Card,
  Choices,
  Empty,
  go,
  Mascot,
  Pill,
  PreviewNote,
  Row,
  Screen,
  SearchBox,
  T,
} from "../components/ui";

export default function DiscoverScreen() {
  const [tab, setTab] = useState("面经社区");
  const [filter, setFilter] = useState("全部");
  const [query, setQuery] = useState("");
  const { saved, toggleSaved } = useDemo();
  const isJobs = tab === "岗位机会";
  const items = experiences.filter(
    (e) =>
      (filter === "全部" || e.language === filter || e.company === filter) &&
      (e.title + e.company + e.category)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const jobItems = jobs.filter(
    (j) =>
      (filter === "全部" ||
        j.type === filter ||
        (filter === "已收藏" && saved.includes(j.id))) &&
      (j.title + j.company + j.city)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <Screen
      title="发现"
      right={<Mascot image={isJobs ? artwork.detective : artwork.avatar} />}
    >
      <Row
        style={{
          backgroundColor: "#F1EEE6",
          padding: 4,
          borderRadius: 16,
          gap: 4,
        }}
      >
        {["面经社区", "岗位机会"].map((label) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === label }}
            key={label}
            onPress={() => {
              setTab(label);
              setFilter("全部");
              setQuery("");
            }}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
              backgroundColor: label === tab ? c.card : "transparent",
            }}
          >
            <T size={14} weight="700" color={label === tab ? c.ink : c.muted}>
              {label}
            </T>
          </Pressable>
        ))}
      </Row>
      <View style={{ gap: 13 }}>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={isJobs ? "搜索岗位、公司或城市" : "搜索公司、岗位或面经"}
        />
        <Choices
          value={filter}
          onChange={setFilter}
          options={
            isJobs
              ? ["全部", "学生工", "实习", "已收藏"]
              : ["全部", "英语", "德语", "SAP"]
          }
          tone="gold"
        />
      </View>
      <Row style={{ justifyContent: "space-between", marginBottom: -10 }}>
        <T size={12} color={c.muted}>
          {isJobs ? `${jobItems.length} 个岗位` : `${items.length} 篇面经`}
        </T>
        <SlidersHorizontal size={15} color={c.muted} />
      </Row>
      {isJobs ? (
        jobItems.length ? (
          jobItems.map((job) => (
            <Card key={job.id}>
              <Row>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    backgroundColor: toneColors(job.color).soft,
                    borderRadius: 13,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <T
                    size={job.initial.length > 1 ? 13 : 22}
                    weight="700"
                    color={toneColors(job.color).main}
                  >
                    {job.initial}
                  </T>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <T size={12} weight="700">
                    {job.company}
                  </T>
                  <Row style={{ gap: 4 }}>
                    <MapPin size={11} color={c.muted} />
                    <T size={10} color={c.muted}>
                      {job.city} · {job.mode}
                    </T>
                  </Row>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    (saved.includes(job.id) ? "取消收藏 " : "收藏 ") +
                    job.company +
                    " 岗位"
                  }
                  onPress={(e) => {
                    e.stopPropagation();
                    toggleSaved(job.id);
                  }}
                  style={{ padding: 10 }}
                >
                  <Bookmark
                    size={19}
                    color={saved.includes(job.id) ? c.gold : c.muted}
                    fill={saved.includes(job.id) ? c.goldLight : "transparent"}
                  />
                </Pressable>
              </Row>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={"查看岗位 " + job.title}
                onPress={() => go("/job?id=" + job.id)}
                style={{ gap: 12 }}
              >
                <T size={17} weight="700">
                  {job.title}
                </T>
                <Row>
                  <Pill tone="gold">{job.type}</Pill>
                  <T size={11} color={c.muted}>
                    {job.match}
                  </T>
                </Row>
              </Pressable>
            </Card>
          ))
        ) : (
          <Empty
            title="暂时没有匹配的岗位"
            text="试试其他关键词，或切换筛选条件。"
          />
        )
      ) : items.length ? (
        items.map((item) => (
          <Card
            key={item.id}
            onPress={() => go("/experience?id=" + item.id)}
            label={"阅读面经 " + item.title}
          >
            <Row>
              <View
                style={{
                  height: 32,
                  width: 32,
                  borderRadius: 16,
                  backgroundColor: toneColors(item.color).soft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <T size={13} weight="700" color={toneColors(item.color).main}>
                  {item.avatar}
                </T>
              </View>
              <View style={{ flex: 1 }}>
                <T size={11} weight="600">
                  {item.author}
                </T>
                <T size={9} color={c.muted}>
                  {item.time}
                </T>
              </View>
              <Pill tone={item.color} small>
                {item.company}
              </Pill>
            </Row>
            <T size={17} weight="700">
              {item.title}
            </T>
            <T size={12} color={c.muted} numberOfLines={2}>
              {item.excerpt}
            </T>
            <Row style={{ justifyContent: "space-between" }}>
              <T size={10} color={c.gold}>
                # {item.category}　# {item.language}面试
              </T>
              <Row style={{ gap: 10 }}>
                <Row style={{ gap: 3 }}>
                  <Heart size={12} color={c.muted} />
                  <T size={10} color={c.muted}>
                    {item.likes}
                  </T>
                </Row>
                <Row style={{ gap: 3 }}>
                  <MessageCircle size={12} color={c.muted} />
                  <T size={10} color={c.muted}>
                    {item.comments}
                  </T>
                </Row>
              </Row>
            </Row>
          </Card>
        ))
      ) : (
        <Empty title="还没有找到这篇故事" text="换一个公司或岗位关键词试试。" />
      )}
      <PreviewNote>
        {isJobs
          ? "岗位为设计示例，不代表正在招聘的真实职位。"
          : "面经为展示用示例，不代表真实用户发布。"}
      </PreviewNote>
    </Screen>
  );
}
