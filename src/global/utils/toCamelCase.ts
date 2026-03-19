type SnakeToCamel<Snake extends string> =
  Snake extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<SnakeToCamel<Tail>>}`
  : Snake;

type ToCamelCase<Target> =
  Target extends Array<infer Element>
  ? ToCamelCase<Element>[]
  : Target extends object
    ? { [Key in keyof Target as SnakeToCamel<Key & string>]: ToCamelCase<Target[Key]> }
    : Target;

const toCamel = (string: string) => string.replace(/_([a-z])/g, (_, character) => character.toUpperCase());

export function toCamelCase<Target>(object: Target): ToCamelCase<Target> {
  if (Array.isArray(object)) return object.map(toCamelCase) as ToCamelCase<Target>;
  if (object !== null && typeof object === 'object') {
    return Object.fromEntries(
      Object.entries(object).map(([key, value]) => [toCamel(key), toCamelCase(value)])
    ) as ToCamelCase<Target>;
  }
  return object as ToCamelCase<Target>;
}