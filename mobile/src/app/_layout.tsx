import React from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_700Bold } from "@expo-google-fonts/dm-sans/700Bold";
import { DemoProvider } from "../state";
import { colors } from "../theme";

export const unstable_settings = { anchor: "(tabs)" };
export default function RootLayout() {
  const [loaded, error] = useFonts({
    DMRegular: DMSans_400Regular,
    DMMedium: DMSans_500Medium,
    DMBold: DMSans_700Bold,
  });
  if (!loaded && !error)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.paper,
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.green} />
      </View>
    );
  return (
    <SafeAreaProvider>
      <DemoProvider>
        <StatusBar style="dark" />
        <View style={{ flex: 1, backgroundColor: "#EDEBE5" }}>
          <View
            style={{
              flex: 1,
              width: "100%",
              maxWidth: Platform.OS === "web" ? 480 : undefined,
              alignSelf: "center",
              backgroundColor: colors.paper,
              overflow: "hidden",
            }}
          >
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.paper },
                animation: "slide_from_right",
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="interview"
                options={{ gestureEnabled: false }}
              />
            </Stack>
          </View>
        </View>
      </DemoProvider>
    </SafeAreaProvider>
  );
}
