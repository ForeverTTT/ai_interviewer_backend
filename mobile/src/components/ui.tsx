import React from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Search,
  type LucideIcon,
} from "lucide-react-native";
import { artwork, colors as c, toneColors, type Tone } from "../theme";

export const go = (href: string) => router.push(href as Href);
export function T({
  size = 14,
  weight = "400",
  color = c.ink,
  style,
  ...props
}: TextProps & {
  size?: number;
  weight?: "400" | "500" | "600" | "700" | "800";
  color?: string;
}) {
  return (
    <Text
      {...props}
      style={[
        {
          fontSize: size,
          lineHeight: size * 1.48,
          color,
          fontWeight: weight,
          fontFamily:
            weight === "700" || weight === "800"
              ? "DMBold"
              : weight === "600" || weight === "500"
                ? "DMMedium"
                : "DMRegular",
        },
        style,
      ]}
    />
  );
}
export function Row({
  children,
  style,
}: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return (
    <View
      style={[{ flexDirection: "row", alignItems: "center", gap: 10 }, style]}
    >
      {children}
    </View>
  );
}
export function Card({
  children,
  style,
  onPress,
  label,
}: React.PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  label?: string;
}>) {
  const base = [styles.card, style];
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        ...base,
        pressed && { opacity: 0.8, transform: [{ scale: 0.99 }] },
      ]}
    >
      {children}
    </Pressable>
  ) : (
    <View style={base}>{children}</View>
  );
}
export function IconButton({
  icon: Icon,
  onPress,
  label,
  color = c.ink,
  background = c.card,
}: {
  icon: LucideIcon;
  onPress: () => void;
  label: string;
  color?: string;
  background?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: background, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Icon size={21} color={color} strokeWidth={1.8} />
    </Pressable>
  );
}
export function Button({
  children,
  onPress,
  tone = "green",
  variant = "solid",
  icon: Icon,
  disabled = false,
  style,
}: React.PropsWithChildren<{
  onPress: () => void;
  tone?: Tone;
  variant?: "solid" | "soft" | "outline";
  icon?: LucideIcon;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}>) {
  const { main, soft } = toneColors(tone);
  const foreground = variant === "solid" ? "#FFFFFF" : main;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor:
            variant === "solid"
              ? main
              : variant === "soft"
                ? soft
                : "transparent",
          borderColor: variant === "outline" ? c.line : "transparent",
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <T weight="700" color={foreground}>
        {children}
      </T>
      {Icon && <Icon size={18} color={foreground} />}
    </Pressable>
  );
}
export function Pill({
  children,
  tone = "green",
  small = false,
}: React.PropsWithChildren<{ tone?: Tone; small?: boolean }>) {
  const { main, soft } = toneColors(tone);
  return (
    <View
      style={{
        backgroundColor: soft,
        borderRadius: 8,
        paddingVertical: small ? 3 : 5,
        paddingHorizontal: 9,
        alignSelf: "flex-start",
      }}
    >
      <T size={small ? 10 : 11} weight="600" color={main}>
        {children}
      </T>
    </View>
  );
}
export function Section({
  title,
  action,
  onPress,
  subtitle,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
  subtitle?: string;
}) {
  return (
    <View style={{ gap: 5 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <T size={18} weight="700">
          {title}
        </T>
        {Boolean(action) && (
          <Pressable
            accessibilityRole="button"
            onPress={onPress}
            style={{ minHeight: 36, justifyContent: "center" }}
          >
            <Row style={{ gap: 3 }}>
              <T size={12} color={c.muted}>
                {action}
              </T>
              <ChevronRight size={14} color={c.muted} />
            </Row>
          </Pressable>
        )}
      </Row>
      {Boolean(subtitle) && (
        <T size={12} color={c.muted}>
          {subtitle}
        </T>
      )}
    </View>
  );
}
export function Screen({
  children,
  title,
  back = false,
  right,
  footer,
  contentStyle,
}: React.PropsWithChildren<{
  title?: string;
  back?: boolean;
  right?: React.ReactNode;
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}>) {
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {Boolean(title) && (
          <Row style={styles.header}>
            {back && (
              <IconButton
                icon={ArrowLeft}
                label="返回"
                background="transparent"
                onPress={() =>
                  router.canGoBack() ? router.back() : router.replace("/")
                }
              />
            )}
            <T size={back ? 17 : 23} weight="700" style={{ flex: 1 }}>
              {title}
            </T>
            {right}
          </Row>
        )}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, contentStyle]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {footer && (
          <SafeAreaView edges={["bottom"]} style={styles.footer}>
            {footer}
          </SafeAreaView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Mascot({
  image,
  size = 44,
}: {
  image: ImageSourcePropType;
  size?: number;
}) {
  return (
    <Image
      source={image}
      resizeMode="contain"
      accessible={false}
      style={{ width: size, height: size }}
    />
  );
}
export function Progress({
  value,
  tone = "green",
  height = 5,
}: {
  value: number;
  tone?: Tone;
  height?: number;
}) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: value }}
      style={{
        height,
        backgroundColor: toneColors(tone).soft,
        borderRadius: 99,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: (Math.max(0, Math.min(100, value)) + "%") as `${number}%`,
          height,
          backgroundColor: toneColors(tone).main,
          borderRadius: 99,
        }}
      />
    </View>
  );
}
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  secureTextEntry = false,
  keyboardType = "default",
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address";
}) {
  return (
    <View style={{ gap: 9 }}>
      <T size={13} weight="600">
        {label}
      </T>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#A09B9F"
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        style={[
          styles.input,
          multiline && {
            minHeight: 124,
            textAlignVertical: "top",
            paddingTop: 14,
          },
        ]}
      />
    </View>
  );
}
export function Choices({
  label,
  options,
  value,
  onChange,
  tone = "blue",
}: {
  label?: string;
  options: string[];
  value: string;
  onChange: (option: string) => void;
  tone?: Tone;
}) {
  const { main, soft } = toneColors(tone);
  return (
    <View style={{ gap: 10 }}>
      {Boolean(label) && (
        <T size={13} weight="600">
          {label}
        </T>
      )}
      <Row style={{ flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: option === value }}
            onPress={() => onChange(option)}
            style={[
              styles.choice,
              {
                backgroundColor: value === option ? soft : c.card,
                borderColor: value === option ? main : c.line,
              },
            ]}
          >
            <T
              size={12}
              weight={value === option ? "700" : "400"}
              color={value === option ? main : c.muted}
            >
              {option}
            </T>
          </Pressable>
        ))}
      </Row>
    </View>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Row style={[styles.input, { gap: 9 }]}>
      <Search size={18} color={c.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          color: c.ink,
          paddingVertical: 4,
        }}
      />
    </Row>
  );
}
export function MenuRow({
  icon: Icon,
  title,
  subtitle,
  onPress,
  tone = "green",
  end,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  tone?: Tone;
  end?: React.ReactNode;
}) {
  const content = (
    <Row style={{ paddingVertical: 15 }}>
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          backgroundColor: toneColors(tone).soft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={19} color={toneColors(tone).main} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T size={14} weight="600">
          {title}
        </T>
        {Boolean(subtitle) && (
          <T size={11} color={c.muted}>
            {subtitle}
          </T>
        )}
      </View>
      {end || (onPress && <ChevronRight size={17} color={c.muted} />)}
    </Row>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {content}
    </Pressable>
  ) : (
    content
  );
}
export function ToolCard({
  title,
  subtitle,
  image,
  tone,
  onPress,
}: {
  title: string;
  subtitle: string;
  image: ImageSourcePropType;
  tone: Tone;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        height: 124,
        padding: 17,
        borderRadius: 22,
        backgroundColor: toneColors(tone).soft,
        overflow: "hidden",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <T size={16} weight="700">
        {title}
      </T>
      <T size={10} color={c.muted} style={{ marginTop: 4 }}>
        {subtitle}
      </T>
      <Image
        source={image}
        style={{
          position: "absolute",
          right: 10,
          bottom: 6,
          width: 66,
          height: 66,
        }}
        resizeMode="contain"
      />
      <ArrowUpRight
        size={18}
        color={toneColors(tone).main}
        style={{ position: "absolute", left: 17, bottom: 18 }}
      />
    </Pressable>
  );
}
export function PreviewNote({
  children = "当前为 UI 预览，内容为示例数据。",
}: React.PropsWithChildren) {
  return (
    <T
      size={10}
      color={c.muted}
      style={{ textAlign: "center", paddingVertical: 8 }}
    >
      {children}
    </T>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <Card style={{ alignItems: "center", gap: 8, paddingVertical: 40 }}>
      <Mascot image={artwork.avatar} size={64} />
      <T weight="700">{title}</T>
      <T size={12} color={c.muted}>
        {text}
      </T>
    </Card>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.paper },
  content: { padding: 22, paddingTop: 10, paddingBottom: 30, gap: 22 },
  header: {
    minHeight: 66,
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 8,
  },
  card: {
    borderRadius: 22,
    backgroundColor: c.card,
    padding: 20,
    borderWidth: 1,
    borderColor: "#F0EDE5",
    gap: 12,
  },
  iconButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 99,
  },
  button: {
    minHeight: 50,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  input: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 14,
    minHeight: 50,
    paddingHorizontal: 14,
    color: c.ink,
    fontSize: 14,
    lineHeight: 23,
  },
  choice: {
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 12,
  },
  footer: {
    paddingHorizontal: 22,
    paddingTop: 13,
    paddingBottom: 14,
    gap: 8,
    backgroundColor: c.paper,
    borderTopWidth: 1,
    borderTopColor: c.line,
  },
});
