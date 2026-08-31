import React, { useMemo } from 'react';
import { StyleSheet, View, Text, ViewProps } from 'react-native';
import { GestureResponderEvent } from 'react-native';

type Props = ViewProps & {
  minimumValue: number;
  maximumValue: number;
  step?: number;
  value: number;
  onValueChange: (v: number) => void;
  trackColor?: string;
  accent?: string;
};

// Minimal pure-View slider (avoids native @react-native-community/slider dependency for Expo Go)
export default function Slider({
  minimumValue, maximumValue, step = 1, value, onValueChange,
  trackColor = '#252a28', accent = '#00d4b8', style,
  ...rest
}: Props) {
  const range = Math.max(0.0001, maximumValue - minimumValue);
  const frac = Math.max(0, Math.min(1, (value - minimumValue) / range));

  const onPress = (e: GestureResponderEvent) => {
    const target = e.currentTarget as any;
    target.measure((_x: number, _y: number, width: number) => {
      const locX = e.nativeEvent.locationX;
      const f = Math.max(0, Math.min(1, locX / Math.max(1, width)));
      let v = minimumValue + f * range;
      v = Math.round(v / step) * step;
      onValueChange(v);
    });
  };

  const onMove = (e: GestureResponderEvent) => {
    const target = e.currentTarget as any;
    target.measure((_x: number, _y: number, width: number) => {
      const locX = e.nativeEvent.locationX;
      const f = Math.max(0, Math.min(1, locX / Math.max(1, width)));
      let v = minimumValue + f * range;
      v = Math.round(v / step) * step;
      onValueChange(v);
    });
  };

  return (
    <View style={[styles.wrap, style]} {...rest}>
      <View
        style={[styles.track, { backgroundColor: trackColor }]}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={onPress}
        onResponderMove={onMove}
      >
        <View style={[styles.fill, { width: `${frac * 100}%`, backgroundColor: accent }]} />
        <View style={[styles.thumb, { left: `${frac * 100}%`, backgroundColor: accent, borderColor: '#0a0c0b' }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', height: 36, justifyContent: 'center' },
  track: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    position: 'relative',
    overflow: 'visible',
  },
  fill: { height: '100%', borderRadius: 4 },
  thumb: {
    position: 'absolute',
    top: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    transform: [{ translateX: -10 }],
  },
});
