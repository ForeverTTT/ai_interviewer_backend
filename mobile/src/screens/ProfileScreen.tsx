import React from "react";
import { Image, Pressable, View } from "react-native";
import {
  ArrowUpRight,
  Bookmark,
  ChevronRight,
  CircleHelp,
  FileText,
  History,
  LogIn,
  Settings,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react-native";
import { artwork, colors as c } from "../theme";
import { useDemo } from "../state";
import {
  Card,
  go,
  IconButton,
  MenuRow,
  Pill,
  PreviewNote,
  Row,
  Screen,
  T,
} from "../components/ui";

export default function ProfileScreen() {
  const { name, target, saved: allSaved } = useDemo();
  const saved = allSaved.filter((id) => !id.startsWith("q"));
  return (
    <Screen
      title="我的"
      right={
        <IconButton
          icon={Settings}
          label="设置"
          onPress={() => go("/settings")}
        />
      }
    >
      <Row style={{ gap: 16, paddingVertical: 12 }}>
        <View
          style={{
            width: 82,
            height: 82,
            borderRadius: 28,
            backgroundColor: c.goldLight,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image
            source={artwork.avatar}
            style={{ width: 78, height: 78 }}
            resizeMode="contain"
          />
        </View>
        <View style={{ gap: 6, flex: 1 }}>
          <T size={25} weight="700">
            {name}
          </T>
          <T size={12} color={c.muted}>
            {target}
          </T>
          <Pill small tone="green">
            正在寻找新的机会
          </Pill>
        </View>
      </Row>
      <Card style={{ backgroundColor: c.blue, borderWidth: 0 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Row style={{ gap: 6 }}>
            <Zap color="#F8DFA5" size={17} />
            <T size={13} color="#E6E9F2">
              我的能量
            </T>
          </Row>
          <Pill small tone="gold">
            示例账户
          </Pill>
        </Row>
        <Row style={{ alignItems: "baseline", gap: 8 }}>
          <T size={38} weight="700" color="#FFFFFF">
            1,000
          </T>
          <T size={12} color="#D3D9E8">
            能量
          </T>
        </Row>
        <T size={11} color="#D3D9E8">
          一场模拟面试 300 能量 · 简历诊断 200 能量
        </T>
      </Card>
      <Card onPress={() => go("/goal")} label="编辑求职目标">
        <Row>
          <View style={{ flex: 1, gap: 4 }}>
            <T size={10} color={c.muted}>
              求职目标
            </T>
            <T size={16} weight="700">
              {target}
            </T>
            <T size={11} color={c.muted}>
              德国 · 学生工 / 实习
            </T>
          </View>
          <ArrowUpRight color={c.green} size={22} />
        </Row>
      </Card>
      <Card style={{ paddingVertical: 0 }}>
        <MenuRow
          icon={UserRound}
          title="个人资料"
          subtitle="名字与求职方向"
          tone="pink"
          onPress={() => go("/settings?section=profile")}
        />
        <MenuRow
          icon={FileText}
          title="我的简历"
          subtitle="简历诊断、优化与求职信"
          tone="pink"
          onPress={() => go("/resume")}
        />
        <MenuRow
          icon={History}
          title="练习记录"
          subtitle="历史面试与评估报告"
          onPress={() => go("/history")}
        />
        <MenuRow
          icon={Bookmark}
          title="题目收藏"
          subtitle="闪卡复习与掌握记录"
          onPress={() => go("/notes")}
        />
        <MenuRow
          icon={Sparkles}
          title="我的优势"
          subtitle="自评题目与结果"
          tone="gold"
          onPress={() => go("/strengths")}
        />
      </Card>
      <Card style={{ paddingVertical: 0 }}>
        <MenuRow
          icon={Bookmark}
          title="收藏的面经与岗位"
          subtitle={saved.length + " 条收藏"}
          tone="gold"
          onPress={() => go("/saved")}
        />
        <MenuRow
          icon={CircleHelp}
          title="帮助与反馈"
          subtitle="问题反馈与使用建议"
          tone="blue"
          onPress={() => go("/feedback")}
        />
        <MenuRow
          icon={LogIn}
          title="登录 / 创建账号"
          subtitle="预览登录界面"
          tone="blue"
          onPress={() => go("/login")}
        />
      </Card>
      <Pressable accessibilityRole="button" onPress={() => go("/settings")}>
        <Row style={{ justifyContent: "center" }}>
          <T size={11} color={c.muted}>
            FlowLab · 不卡壳实验室
          </T>
          <ChevronRight size={12} color={c.muted} />
        </Row>
      </Pressable>
      <PreviewNote />
    </Screen>
  );
}
