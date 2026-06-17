import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { TextInput, Button, Text } from 'react-native-paper'

interface ManualDobPickerProps {
  onComplete: (isAdult: boolean) => void
}

function isValidBirthDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }

  const birth = new Date(year, month - 1, day)
  if (
    birth.getFullYear() !== year ||
    birth.getMonth() !== month - 1 ||
    birth.getDate() !== day
  ) {
    return false
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  birth.setHours(0, 0, 0, 0)
  return birth <= today
}

function calculateAge(year: number, month: number, day: number): number {
  const today = new Date()
  const birth = new Date(year, month - 1, day) // month is 1-indexed from inputs
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

export function ManualDobPicker({ onComplete }: ManualDobPickerProps) {
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const [year, setYear] = useState('')

  const handleSubmit = () => {
    const m = parseInt(month, 10)
    const d = parseInt(day, 10)
    const y = parseInt(year, 10)

    if (year.length !== 4 || !isValidBirthDate(y, m, d)) return

    const age = calculateAge(y, m, d)
    onComplete(age >= 18)
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Enter your date of birth to continue.</Text>
      <View style={styles.row}>
        <TextInput
          testID="dob-month"
          label="Month"
          value={month}
          onChangeText={setMonth}
          keyboardType="number-pad"
          maxLength={2}
          style={styles.field}
        />
        <TextInput
          testID="dob-day"
          label="Day"
          value={day}
          onChangeText={setDay}
          keyboardType="number-pad"
          maxLength={2}
          style={styles.field}
        />
        <TextInput
          testID="dob-year"
          label="Year"
          value={year}
          onChangeText={setYear}
          keyboardType="number-pad"
          maxLength={4}
          style={styles.yearField}
        />
      </View>
      <Button testID="dob-submit" mode="contained" onPress={handleSubmit} style={styles.button}>
        Continue
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  heading: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  field: {
    width: 70,
  },
  yearField: {
    width: 90,
  },
  button: {
    width: '100%',
  },
})
