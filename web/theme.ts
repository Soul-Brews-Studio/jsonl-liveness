export const themes=[
  {value:"paper",label:"Paper"},
  {value:"dark",label:"Midnight"},
  {value:"vangogh",label:"Van Gogh · Starry Night"},
] as const;

export type Theme=(typeof themes)[number]["value"];

export function initialTheme(value:string|null):Theme {
  return themes.some(theme=>theme.value===value)?value as Theme:"paper";
}
