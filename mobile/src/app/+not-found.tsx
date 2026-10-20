import { Button, go, Screen, T } from "../components/ui";
export default function NotFound() {
  return (
    <Screen title="暂时找不到这一页">
      <T>页面不存在，请返回首页。</T>
      <Button onPress={() => go("/")}>回到今日</Button>
    </Screen>
  );
}
