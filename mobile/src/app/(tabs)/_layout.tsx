import React from "react";
import { View } from "react-native";
import { Tabs } from "expo-router";
import { Compass, House, Mic, UserRound } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors as c } from "../../theme";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.greenDark,
        tabBarInactiveTintColor: "#96919A",
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          height: 72 + insets.bottom,
          paddingTop: 9,
          paddingBottom: Math.max(insets.bottom, 9),
          backgroundColor: "#FFFDF8",
          borderTopColor: c.line,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: "DMMedium",
          marginTop: 2,
        },
        sceneStyle: { backgroundColor: c.paper },
      }}
    >
      {[
        { name: "index", title: "今日", icon: House },
        { name: "practice", title: "练习", icon: Mic },
        { name: "discover", title: "发现", icon: Compass },
        { name: "profile", title: "我的", icon: UserRound },
      ].map(({ name, title, icon: Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarAccessibilityLabel: title,
            tabBarIcon: ({ color, focused }) => (
              <View
                style={{
                  width: 52,
                  height: 30,
                  backgroundColor: focused ? c.greenLight : "transparent",
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon
                  color={color}
                  size={21}
                  strokeWidth={focused ? 2.2 : 1.7}
                />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
