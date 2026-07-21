package model

import (
	"reflect"
	"testing"
)

func TestEquivalentTaskStatuses(t *testing.T) {
	if got, want := EquivalentTaskStatuses(TaskStatusSuccess), []TaskStatus{TaskStatusSuccess, TaskStatusSucceeded}; !reflect.DeepEqual(got, want) {
		t.Fatalf("EquivalentTaskStatuses(success) = %v, want %v", got, want)
	}
	if got, want := EquivalentTaskStatuses(TaskStatusFailed), []TaskStatus{TaskStatusFailed}; !reflect.DeepEqual(got, want) {
		t.Fatalf("EquivalentTaskStatuses(failed) = %v, want %v", got, want)
	}
}
