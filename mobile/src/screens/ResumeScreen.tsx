import React, { useState } from "react";
import { View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { FileText, Sparkles, Upload } from "lucide-react-native";
import { artwork, colors as c } from "../theme";
import {
  Button,
  Card,
  Choices,
  Field,
  Mascot,
  Pill,
  PreviewNote,
  Progress,
  Row,
  Screen,
  Section,
  T,
} from "../components/ui";

export default function ResumeScreen() {
  const [tab, setTab] = useState("简历诊断");
  const [filename, setFilename] = useState("Hayden_CV.pdf");
  const [picked, setPicked] = useState(false);
  const [jd, setJd] = useState("");
  const [result, setResult] = useState(false);
  const [error, setError] = useState("");
  const pick = async () => {
    try {
      const file = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: false,
        multiple: false,
      });
      if (file.canceled) return;
      if ((file.assets[0].size || 0) > 12 * 1024 * 1024) {
        setError("请选择 12 MB 以内的 PDF。");
        return;
      }
      setFilename(file.assets[0].name);
      setPicked(true);
      setError("");
      setResult(false);
    } catch {
      setError("文件暂时无法打开，请重新选择。");
    }
  };
  return (
    <Screen title="简历工作室" back right={<Mascot image={artwork.tailor} />}>
      <Choices
        value={tab}
        onChange={(value) => {
          setTab(value);
          setResult(false);
        }}
        options={["简历诊断", "定向优化", "求职信"]}
        tone="pink"
      />
      <Card>
        <Row>
          <View
            style={{
              width: 45,
              height: 53,
              backgroundColor: c.pinkLight,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
            }}
          >
            <FileText size={24} color={c.pink} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <T size={14} weight="600" numberOfLines={2}>
              {filename}
            </T>
            <T size={10} color={c.muted}>
              {picked ? "仅本地选择 · 尚未上传" : "示例简历 · 用于界面预览"}
            </T>
          </View>
        </Row>
        <Button variant="outline" tone="pink" icon={Upload} onPress={pick}>
          选择一份简历 PDF
        </Button>
        <T size={10} color={c.muted}>
          支持 PDF，最大 12 MB。本版不会上传文件。
        </T>
        {Boolean(error) && (
          <T size={12} color={c.danger}>
            {error}
          </T>
        )}
      </Card>
      {tab !== "简历诊断" && (
        <Field
          label="你想申请的岗位 JD"
          value={jd}
          onChangeText={setJd}
          placeholder="粘贴目标岗位的职责与要求"
          multiline
        />
      )}
      <Button tone="pink" icon={Sparkles} onPress={() => setResult(true)}>
        {tab === "简历诊断"
          ? "查看诊断示例"
          : tab === "定向优化"
            ? "查看优化示例"
            : "查看求职信示例"}
      </Button>
      {result ? (
        tab === "简历诊断" ? (
          <>
            <Card>
              <Row style={{ justifyContent: "space-between" }}>
                <View>
                  <Pill tone="pink">示例诊断</Pill>
                  <T size={18} weight="700" style={{ marginTop: 8 }}>
                    简历评分
                  </T>
                </View>
                <T size={39} weight="700" color={c.pink}>
                  78
                </T>
              </Row>
              {[
                { label: "清晰度", value: 85 },
                { label: "成果影响力", value: 68 },
                { label: "结构逻辑", value: 82 },
                { label: "关键词匹配", value: 74 },
              ].map((item) => (
                <View key={item.label} style={{ gap: 6 }}>
                  <Row style={{ justifyContent: "space-between" }}>
                    <T size={12}>{item.label}</T>
                    <T size={12} color={c.pink}>
                      {item.value}
                    </T>
                  </Row>
                  <Progress value={item.value} tone="pink" />
                </View>
              ))}
            </Card>
            <Section title="修改建议" />
            {[
              "把「参与项目」改成你实际负责的行动",
              "为成果补充有依据的结果或影响",
            ].map((title, index) => (
              <Card key={title}>
                <Row>
                  <Pill tone="pink">0{index + 1}</Pill>
                  <T size={14} weight="600" style={{ flex: 1 }}>
                    {title}
                  </T>
                </Row>
                <T size={12} color={c.muted}>
                  讲清楚你做了什么，以及为什么重要。没有证据的数据不需要添加。
                </T>
              </Card>
            ))}
          </>
        ) : (
          <Card>
            <Pill tone="pink">{tab} · 固定示例</Pill>
            <T size={19} weight="700">
              {tab === "定向优化" ? "让行动和成果更清楚" : "Dear Hiring Team,"}
            </T>
            <T size={14} style={{ lineHeight: 25 }}>
              {tab === "定向优化"
                ? "原句：参与了产品的用户体验优化。\n\n改写思路：负责梳理核心用户流程，通过访谈归纳主要使用障碍，并与产品、工程团队协作迭代原型。\n\n需要你补充：项目范围、自己的责任，以及能够验证的改进结果。"
                : "I am excited to apply for the Product Designer position. My experience in user research and interaction design has taught me to connect people’s needs with clear, thoughtful product decisions.\n\nI would welcome the opportunity to share how my approach could contribute to your team.\n\nBest regards,\nHayden"}
            </T>
            <PreviewNote>这是样式示例，未分析所选简历或输入的 JD。</PreviewNote>
          </Card>
        )
      ) : null}
      <PreviewNote>诊断、优化和求职信暂为 UI 示例，尚未接入 AI。</PreviewNote>
    </Screen>
  );
}
